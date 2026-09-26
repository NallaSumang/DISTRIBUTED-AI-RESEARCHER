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
    # Truncate context to ~6000 chars (~1500 tokens) to ensure prompt_tokens + max_tokens < Groq's 6000 TPM limit
    if len(context) > 6000:
        context = context[:6000] + "... (truncated)"
    prompt = (
        f"Act as a globally recognized Principal AI Architect and Lead Technical Author. Produce an exhaustive, highly detailed, and elite-tier Markdown research manifesto on the following topic: {state['query']}\n"
        f"Structure your masterpiece with the following sections:\n"
        f"1. Executive Overview (High-level summary of the landscape)\n"
        f"2. Deep-Dive Architectural & Contextual Analysis (Extensively detailed breakdown)\n"
        f"3. Core Metrics, Economics, & Key Facts (Data-driven evidence)\n"
        f"4. Prominent Real-World Case Studies (At least 3 highly detailed examples)\n"
        f"5. Visionary & Optimistic Conclusion (Forward-looking trajectory)\n\n"
        f"CRITICAL DIRECTIVES (STRICT LENGTH LIMITS):\n"
        f"- Tone: Hyper-professional, relentlessly optimistic, highly analytical, and visionary.\n"
        f"- Verbosity & Length: Write the most exhaustive, deep, and lengthy report possible, BUT YOU MUST NOT EXCEED 2000 WORDS. You are running on a server with hard token limits. Maximize the depth and quality of the text, but ensure you reach section 5 and gracefully conclude before hitting the limit.\n"
        f"- Pacing: You MUST reach section 5 and write a complete, elegant conclusion.\n"
        f"- Format: Use bolding, bullet points, and sub-headers to make it visually stunning.\n\n"
        f"Context:\n{context}"
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
