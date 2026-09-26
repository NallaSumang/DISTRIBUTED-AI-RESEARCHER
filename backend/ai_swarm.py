import os
import re
import json
from typing import TypedDict, List
from dotenv import load_dotenv
load_dotenv(override=True)

from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage
from duckduckgo_search import DDGS 

class AgentState(TypedDict):
    query: str
    sub_queries: List[str]
    raw_data: List[str]
    final_report: str

def create_planner_llm(max_tokens: int):
    """Planner: uses qwen3.8-27b (reasoning model) — great for structured JSON decomposition."""
    api_key = os.getenv("GROQ_API_KEY")
    primary = ChatGroq(model="qwen/qwen3.8-27b", temperature=0, max_tokens=max_tokens, api_key=api_key)
    fallbacks = [
        ChatGroq(model="openai/gpt-oss-20b", temperature=0, max_tokens=max_tokens, api_key=api_key),
        ChatGroq(model="allam-2-7b", temperature=0, max_tokens=max_tokens, api_key=api_key),
    ]
    return primary.with_fallbacks(fallbacks)

def create_writer_llm(max_tokens: int):
    """Writer: uses gpt-oss-20b (non-reasoning) — avoids <think> token blowout that causes infinite polling.
    qwen3.8-27b emits large <think> blocks that silently exhaust Groq free-tier TPM,
    causing the writer to never finish and result:{job_id} to never be set in Redis."""
    api_key = os.getenv("GROQ_API_KEY")
    primary = ChatGroq(model="openai/gpt-oss-20b", temperature=0, max_tokens=max_tokens, api_key=api_key)
    fallbacks = [
        ChatGroq(model="openai/gpt-oss-120b", temperature=0, max_tokens=max_tokens, api_key=api_key),
        ChatGroq(model="qwen/qwen3.8-27b", temperature=0, max_tokens=max_tokens, api_key=api_key),
        ChatGroq(model="allam-2-7b", temperature=0, max_tokens=max_tokens, api_key=api_key),
    ]
    return primary.with_fallbacks(fallbacks)

# Planner: lightweight — only needs a short JSON list output
planner_llm = create_planner_llm(max_tokens=1024)

# Writer: large output budget — uses non-reasoning model to avoid token blowout
writer_llm = create_writer_llm(max_tokens=4096)

from pydantic import BaseModel, Field

class SearchQueries(BaseModel):
    queries: List[str] = Field(description="List of 3 search queries")

import json

def strip_thinking(text: str) -> str:
    """Remove <think>...</think> blocks emitted by reasoning models (e.g. Qwen3)."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

def planner_agent(state: AgentState):
    print("   -> Planning...")
    prompt = (
        f"As a senior research architect, decompose the following topic into 5 highly targeted, distinct search queries to maximize the breadth and depth of data retrieved.\n"
        f"Topic: '{state['query']}'\n"
        f"Return ONLY a raw JSON list of strings, with no other text, markdown, or schema."
    )
    try:
        res = planner_llm.invoke([HumanMessage(content=prompt)])
        content = strip_thinking(res.content)
        
        # Robustly extract JSON array using regex
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if match:
            content = match.group(0)
        
        try:
            parsed = json.loads(content)
            if isinstance(parsed, list) and len(parsed) > 0:
                return {"sub_queries": parsed[:5]}
            else:
                return {"sub_queries": [state['query']]}
        except json.decoder.JSONDecodeError:
            # Absolute fallback if LLM completely hallucinates non-JSON
            return {"sub_queries": [state['query']]}
    except Exception as e:
        print(f"   [!] Planning parsing failed: {e}")
        return {"sub_queries": [state['query']]}

import asyncio

async def get_single_query(query):
    try:
        tavily_key = os.getenv("TAVILY_API_KEY")
        if tavily_key:
            from tavily import AsyncTavilyClient
            client = AsyncTavilyClient(api_key=tavily_key)
            response = await client.search(query=query, max_results=6)
            return [f"Source: {r['url']}\n{r['content']}" for r in response['results']]
        else:
            from duckduckgo_search import DDGS
            def _sync_search():
                with DDGS() as ddgs:
                    return list(ddgs.text(query, max_results=6))
            results = await asyncio.to_thread(_sync_search)
            return [f"Source: {r['href']}\n{r['body']}" for r in results]
    except Exception as e:
        print(f"   ⚠️ Search failed for '{query}': {e}")
        return [f"Search failed for: {query}"]

def search_agent(state: AgentState):
    print(f"   -> Searching {len(state['sub_queries'])} sub-queries in parallel...")
    
    async def execute_parallel_research(sub_queries):
        tasks = [get_single_query(q) for q in sub_queries]
        return await asyncio.gather(*tasks)
    
    # Run the async code in a synchronous wrapper
    parallel_results = asyncio.run(execute_parallel_research(state['sub_queries']))
    
    # Flatten the results
    results = [item for sublist in parallel_results for item in sublist]
    
    if not results:
        results.append("No search results found. Generate report from existing knowledge.")
    return {"raw_data": results}

def writer_agent(state: AgentState):
    print("   -> Writing...")
    context = "\n\n".join(state['raw_data'])

    # Context budget: gpt-oss-20b has 131K ctx window.
    # 20000 chars ≈ 5000 tokens of search evidence — gives the writer rich grounding.
    # Old limit was 6000 chars (Qwen-era leftover) which starved the writer of real data.
    if len(context) > 20000:
        context = context[:20000] + "\n\n... [additional sources truncated for token budget]"

    prompt = (
        f"You are a world-class Principal Research Analyst and Technical Author publishing for a professional audience. "
        f"Your task is to write an exhaustive, deeply analytical, and richly structured Markdown research report on the following topic:\n\n"
        f"**TOPIC: {state['query']}**\n\n"
        f"---\n\n"
        f"## MANDATORY REPORT STRUCTURE\n\n"
        f"Your report MUST contain ALL of the following sections, each written with maximum depth:\n\n"
        f"### 1. 🌐 Executive Overview\n"
        f"   - A high-level, authoritative summary of the topic landscape\n"
        f"   - Why this topic matters right now (current relevance and momentum)\n"
        f"   - The single most important insight a decision-maker needs to know\n\n"
        f"### 2. 🏗️ Deep-Dive Architecture & Contextual Analysis\n"
        f"   - Comprehensive technical or conceptual breakdown — go deep, not shallow\n"
        f"   - Sub-components, mechanisms, or moving parts explained with precision\n"
        f"   - Historical context and evolution that shaped the current state\n"
        f"   - Key players, institutions, technologies, or frameworks involved\n\n"
        f"### 3. 📊 Core Metrics, Economics & Key Facts\n"
        f"   - Hard data, statistics, benchmarks, and quantitative evidence from the search context\n"
        f"   - Market size, growth rates, adoption curves, or performance numbers where applicable\n"
        f"   - At least 5 distinct, specific data points — cite source URLs from the context\n\n"
        f"### 4. 🔬 Real-World Case Studies & Practical Applications\n"
        f"   - At least 3 detailed, named real-world examples (companies, projects, events, or experiments)\n"
        f"   - For each: what they did, why it worked/failed, and what was learned\n"
        f"   - Draw concrete lessons applicable to the reader\n\n"
        f"### 5. ⚠️ Challenges, Limitations & Critical Perspectives\n"
        f"   - What are the known failure modes, risks, or controversies?\n"
        f"   - What does the opposition or critical camp argue?\n"
        f"   - What unsolved problems remain?\n\n"
        f"### 6. 🚀 Visionary Outlook & Strategic Conclusion\n"
        f"   - Forward-looking trajectory: where is this heading in 2–5 years?\n"
        f"   - Concrete recommendations or action items for a practitioner\n"
        f"   - A memorable, compelling closing statement\n\n"
        f"---\n\n"
        f"## QUALITY & FORMAT DIRECTIVES\n\n"
        f"- **Depth over brevity**: You have a 4096-token output budget. USE IT FULLY. This is not a summary — it is a manifesto.\n"
        f"- **No padding**: Every sentence must carry information. No filler, no vague generalities.\n"
        f"- **Formatting**: Use bold for key terms, bullet points for lists, sub-headers (###, ####) for navigation, and horizontal rules (---) between major sections.\n"
        f"- **Grounding**: Cite specific facts, URLs, names, and data points from the Context below. Do not invent statistics.\n"
        f"- **Completion**: You MUST reach Section 6 and deliver a complete conclusion. Do not truncate mid-section.\n"
        f"- **Tone**: Hyper-professional, analytically rigorous, and forward-looking. Write as if publishing in a top-tier research journal.\n\n"
        f"---\n\n"
        f"## SEARCH CONTEXT (Grounding Data)\n\n"
        f"{context}"
    )
    res = writer_llm.invoke([HumanMessage(content=prompt)])
    return {"final_report": strip_thinking(res.content)}


workflow = StateGraph(AgentState)
workflow.add_node("planner", planner_agent)
workflow.add_node("searcher", search_agent)
workflow.add_node("writer", writer_agent)
workflow.set_entry_point("planner")
workflow.add_edge("planner", "searcher")
workflow.add_edge("searcher", "writer")
workflow.add_edge("writer", END)
research_app = workflow.compile()

def execute_research(query: str):
    return research_app.invoke({"query": query, "sub_queries": [], "raw_data": [], "final_report": ""})['final_report']# trigger sync
