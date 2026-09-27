"use client";
import { useState, useEffect, useCallback, memo } from "react";
import {
  Search,
  Loader2,
  BookOpen,
  Sparkles,
  History,
  Globe,
  Zap,
  Brain,
  X,
  Menu,
  ChevronUp,
  Plus,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase Client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** Typed shape for items fetched from research_history */
interface ResearchItem {
  id: string;
  query: string;
  report: string;
  created_at: string;
}

/** Strip <think>...</think> blocks that reasoning models (e.g. Qwen3) emit. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/* ------------------------------------------------------------------ */
/*  SIDEBAR CONTENT — hoisted outside render, memoised                  */
/*  (was recreated on every render as an inline component)              */
/* ------------------------------------------------------------------ */
interface SidebarProps {
  history: ResearchItem[];
  onSelect: (report: string) => void;
  onClose: () => void;
}

const SidebarContent = memo(function SidebarContent({
  history,
  onSelect,
  onClose,
}: SidebarProps) {
  return (
    <>
      <div className="p-6 border-b border-white/[0.03] shrink-0">
        <div className="flex items-center gap-3 text-red-900/70 mb-1">
          <History size={14} />
          <span className="text-[9px] font-medium uppercase tracking-[0.3em]">
            Neural Memory
          </span>
        </div>
        <h2 className="text-sm font-light tracking-widest text-zinc-100">
          Recent Research
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {history.length === 0 && (
          <p className="text-[11px] text-zinc-600 text-center mt-8 tracking-widest">
            No research yet
          </p>
        )}
        {history.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              onSelect(stripThinking(item.report));
              onClose();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="w-full text-left p-4 rounded-xl bg-white/[0.01] border border-white/[0.02] hover:bg-white/[0.03] hover:border-red-900/20 transition-colors duration-150 group"
          >
            <p className="text-xs font-light leading-relaxed line-clamp-2 text-zinc-500 group-hover:text-zinc-200 transition-colors duration-150">
              {item.query}
            </p>
            <p className="text-[9px] text-zinc-500 mt-2 font-mono tracking-widest">
              {new Date(item.created_at).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "numeric",
                year: "numeric",
              })}
            </p>
          </button>
        ))}
      </div>
    </>
  );
});

/* ------------------------------------------------------------------ */
/*  AI SWARM LOADER — replaces the plain single-ring spinner           */
/* ------------------------------------------------------------------ */
function SwarmLoader({ stageText }: { stageText: string }) {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-14 h-14">
        {/* outer ring — slow clockwise */}
        <div className="absolute inset-0 rounded-full border border-red-950/60 border-t-red-700/70 animate-[spin-slow_3s_linear_infinite]" />
        {/* mid ring — medium counter-clockwise */}
        <div className="absolute inset-[6px] rounded-full border border-red-900/40 border-t-red-600/60 animate-[spin-reverse_2s_linear_infinite]" />
        {/* inner ring — fast clockwise */}
        <div className="absolute inset-[12px] rounded-full border border-red-900/30 border-t-red-500/50 animate-[spin-slow_1.2s_linear_infinite]" />
        {/* pulse core */}
        <div className="absolute inset-[18px] rounded-full bg-red-900/20 animate-pulse" />
      </div>
      <div className="text-center">
        <p className="text-[11px] font-medium tracking-[0.25em] text-red-500 uppercase animate-pulse drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]">
          {stageText}
        </p>
      </div>
    </div>
  );
}

const LOADING_STAGES = [
  "Initializing Swarm Engine...",
  "Deploying Architect Agent...",
  "Scouts Extracting Data...",
  "Cross-referencing Sources...",
  "Synthesizing Intelligence...",
  "Formatting Masterpiece..."
];

/* ------------------------------------------------------------------ */
/*  TOAST — inline error notification, replaces native alert()         */
/* ------------------------------------------------------------------ */
interface ToastProps {
  message: string;
  onDismiss: () => void;
}

function ErrorToast({ message, onDismiss }: ToastProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-[#0d0000] border border-red-900/40 shadow-[0_0_30px_rgba(127,0,0,0.2)] text-sm text-red-300 font-light tracking-wide backdrop-blur-xl"
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        className="text-red-500/60 hover:text-red-300 transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState("");
  const [history, setHistory] = useState<ResearchItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stable references — prevents SidebarContent memo from breaking on every keystroke
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const dismissError = useCallback(() => setErrorMsg(null), []);
  
  const clearChat = useCallback(() => {
    setReport("");
    setQuery("");
    setJobId(null);
    setLoading(false);
    setErrorMsg(null);
    setLoadingStage(0);
  }, []);

  const fetchHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("research_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setHistory(data as ResearchItem[]);
    if (error) console.error("Memory Fetch Error:", error);
  }, []);

  useEffect(() => {
    fetchHistory();
    let interval: NodeJS.Timeout;
    if (jobId && loading) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/proxy?jobId=${jobId}`);
          if (!res.ok) throw new Error("Polling failed");
          
          setLoadingStage((prev) => Math.min(prev + 1, LOADING_STAGES.length - 1));
          
          const data = await res.json();
          if (data.status === "completed") {
            setReport(stripThinking(data.data));
            setLoading(false);
            setJobId(null);
            fetchHistory();
            clearInterval(interval);
          } else if (data.status === "failed") {
            setReport(data.data || "### Error\nResearch failed.");
            setLoading(false);
            setJobId(null);
            clearInterval(interval);
          }
        } catch (err) {
          console.error("Polling failed:", err);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [jobId, loading, fetchHistory]);

  const handleSearch = async () => {
    if (!query || loading) return;
    setLoading(true);
    setLoadingStage(0);
    setReport("");
    setErrorMsg(null);
    setSidebarOpen(false);
    try {
      const res = await fetch(`/api/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (!data.job_id) throw new Error("No job ID returned");
      setJobId(data.job_id);
    } catch (err) {
      // Backend is on HuggingFace Spaces — not local
      setErrorMsg("HuggingFace Space unreachable — the backend may be cold-starting or sleeping. Retry in a moment.");
      setLoading(false);
    }
  };

  /* ------------------------------------------------------------------ */
  return (
    <div className="relative flex min-h-screen bg-[#030000] text-zinc-300 font-sans tracking-wide selection:bg-red-900/30 overflow-x-hidden">

      {/* ── BACKGROUND EFFECTS ─────────────────────────────────────── */}
      {/* Issue #9 fixed: keyframes moved to globals.css — no inline <style> */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1a0000_0%,#000000_100%)]" />
        <div className="absolute inset-0 [perspective:1000px]">
          <div className="absolute inset-0 origin-bottom [transform:rotateX(60deg)_translateZ(-200px)] opacity-90">
            <div className="absolute inset-[-200%] animate-[grid-pan_4s_linear_infinite] bg-[linear-gradient(to_right,#ff000080_1px,transparent_1px),linear-gradient(to_bottom,#ff000080_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_80%,transparent_100%)]" />
          </div>
        </div>
        <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500 to-transparent animate-[scan-line_6s_ease-in-out_infinite] shadow-[0_0_20px_rgba(255,0,0,0.8)]" />
        <div className="absolute top-1/4  left-1/4  w-2   h-2   bg-red-500    rounded-full shadow-[0_0_20px_5px_rgba(255,0,0,0.9)]   animate-[float-ember_4s_ease-in-out_infinite]" />
        <div className="absolute top-3/4  left-2/3  w-3   h-3   bg-orange-500 rounded-full shadow-[0_0_25px_6px_rgba(255,100,0,0.9)] animate-[float-ember_6s_ease-in-out_infinite_1s]" />
        <div className="absolute top-1/2  left-[15%] w-1.5 h-1.5 bg-yellow-400 rounded-full shadow-[0_0_15px_4px_rgba(255,200,0,0.9)] animate-[float-ember_5s_ease-in-out_infinite_2s]" />
        <div className="absolute top-1/3  right-1/4 w-2   h-2   bg-red-600    rounded-full shadow-[0_0_20px_5px_rgba(255,0,0,0.9)]   animate-[float-ember_7s_ease-in-out_infinite_0.5s]" />
        <div className="absolute inset-0 shadow-[inset_0_0_200px_rgba(0,0,0,1)]" />
      </div>

      {/* ── INLINE TOAST (replaces native alert) ────────────────────── */}
      <AnimatePresence>
        {errorMsg && (
          <ErrorToast message={errorMsg} onDismiss={dismissError} />
        )}
      </AnimatePresence>

      {/* ── MOBILE SIDEBAR OVERLAY ──────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              key="sidebar-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-30 bg-black/70 xl:hidden"
            />
            <motion.aside
              key="sidebar-panel"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", ease: "easeOut", duration: 0.22 }}
              className="fixed inset-y-0 left-0 z-40 w-72 flex flex-col bg-[#07000a]/95 border-r border-white/[0.03] xl:hidden"
            >
              <div className="flex items-center justify-end p-4 shrink-0">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 rounded-lg hover:bg-white/[0.04] text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <SidebarContent
                history={history}
                onSelect={setReport}
                onClose={closeSidebar}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── DESKTOP SIDEBAR ─────────────────────────────────────────── */}
      <aside className="hidden xl:flex w-72 shrink-0 flex-col fixed inset-y-0 left-0 z-20 border-r border-white/[0.02] bg-white/[0.01] backdrop-blur-3xl">
        <SidebarContent
          history={history}
          onSelect={setReport}
          onClose={closeSidebar}
        />
      </aside>

      {/* ── MAIN CONTENT ────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 xl:ml-72 min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-10 py-8 sm:py-12">

          {/* HEADER */}
          <header className="flex items-center justify-between mb-10 sm:mb-16">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="xl:hidden p-2 rounded-xl bg-white/[0.02] border border-white/[0.03] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors duration-150"
              >
                <Menu size={18} />
              </button>
              <div className="bg-gradient-to-br from-red-950 to-[#050505] border border-white/[0.05] p-2.5 rounded-xl shadow-[0_0_30px_rgba(127,29,29,0.15)]">
                <Brain className="text-red-700/80" size={20} strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-light tracking-[0.08em] text-zinc-100 leading-none">
                  DISTRIBUTED{" "}
                  <span className="font-bold text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.8)]">
                    AI
                  </span>
                </h1>
                <div className="text-[8px] font-medium text-red-500/80 tracking-[0.3em] uppercase mt-1">
                  Sumang&apos;s Signature Edition
                </div>
              </div>
            </div>

            {/* Status badges */}
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <button
                onClick={clearChat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.03] hover:text-zinc-200 text-[9px] font-medium text-zinc-400 tracking-widest uppercase transition-colors duration-150"
              >
                <Plus size={11} strokeWidth={1.5} />
                <span className="hidden sm:inline">New Research</span>
                <span className="sm:hidden">New</span>
              </button>

              <div 
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.03] bg-white/[0.01] text-[9px] font-medium text-zinc-400 tracking-widest uppercase cursor-default"
                title="System Status: Web Search Engine is Online"
              >
                <Globe size={11} strokeWidth={1.5} className="text-zinc-500" />
                <div className="flex items-center gap-1.5">
                  <div className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </div>
                  <span>Web Search: Online</span>
                </div>
              </div>
              <div 
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-900/20 bg-red-950/20 text-[9px] font-medium text-red-700/80 tracking-widest uppercase shadow-[0_0_12px_rgba(127,29,29,0.1)] cursor-default"
                title="Active Model: Qwen 3.6 (Primary) / Llama 3 (Fallback)"
              >
                <Zap size={11} strokeWidth={1.5} className="text-red-700/80" />
                <div className="flex items-center gap-1.5">
                  <div className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                  </div>
                  <span>Model: Qwen / Llama 3</span>
                </div>
              </div>
            </div>
          </header>

          {/* SEARCH BOX */}
          <div className="group relative mb-10 sm:mb-16">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-950 to-transparent rounded-3xl blur-2xl opacity-10 group-hover:opacity-20 transition duration-1000" />
            <div className="relative flex flex-row items-center bg-[#050505] border border-white/[0.04] rounded-2xl p-2 shadow-2xl">
              <div className="flex items-center flex-1 px-4">
                <Search className="text-zinc-600 mr-3 shrink-0" size={18} strokeWidth={1.5} />
                <input
                  type="text"
                  className="w-full bg-transparent border-none py-3 sm:py-5 text-sm sm:text-base font-light text-zinc-100 focus:outline-none placeholder:text-zinc-700 tracking-wide"
                  placeholder="Analyze a topic in depth..."
                  value={query}
                  maxLength={2000}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={loading}
                className="bg-zinc-100 text-black hover:bg-white disabled:bg-[#0a0a0a] disabled:text-zinc-700 px-5 py-3 sm:py-5 sm:px-10 rounded-xl sm:rounded-2xl text-xs font-semibold transition-colors duration-150 disabled:border disabled:border-white/[0.02] uppercase tracking-[0.2em] shrink-0"
              >
                {loading ? (
                  <Loader2 className="animate-spin mx-auto" size={15} />
                ) : (
                  "Execute"
                )}
              </button>
            </div>
          </div>

          {/* RESULT AREA */}
          <AnimatePresence mode="wait">
            {loading && !report && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7 }}
                className="py-24 flex justify-center"
              >
                {/* Issue #5 fixed: 3-ring swarm loader replaces single animate-spin ring */}
                <SwarmLoader stageText={LOADING_STAGES[loadingStage]} />
              </motion.div>
            )}

            {report && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="bg-white/[0.01] border border-white/[0.03] rounded-2xl sm:rounded-[2rem] p-6 sm:p-10 lg:p-16 shadow-[0_0_50px_rgba(0,0,0,0.5)]"
              >
                {/* Issue #6 fixed: border bumped to /[0.06]; issue #7 fixed: label is visible */}
                <div className="flex items-center gap-3 mb-8 pb-6 border-b border-white/[0.06]">
                  <BookOpen className="text-red-700/70 shrink-0" size={16} strokeWidth={1.5} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-zinc-400">
                    Analysis Summary
                  </span>
                </div>

                {/* Issue #12 fixed: remarkGfm enables tables, strikethrough, task lists */}
                <article className="report-body max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {report}
                  </ReactMarkdown>
                </article>

                {/* Issue #11: scroll-to-top button at bottom of report */}
                <div className="mt-12 pt-6 border-t border-white/[0.04] flex justify-end">
                  <button
                    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-300 border border-white/[0.03] hover:border-white/[0.07] bg-white/[0.01] hover:bg-white/[0.02] transition-colors duration-150"
                  >
                    <ChevronUp size={12} />
                    Back to top
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* EMPTY STATE */}
          {!loading && !report && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col items-center justify-center pt-16 sm:pt-24 gap-4 text-center"
            >
              <Sparkles className="text-red-900/30" size={40} strokeWidth={1} />
              <p className="text-xs text-zinc-700 tracking-[0.25em] uppercase font-light">
                Enter a topic to begin
              </p>
            </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}

