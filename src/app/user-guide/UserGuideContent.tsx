import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  HelpCircle,
  Search,
} from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import PageHeader from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePermissions } from "../hooks/usePermissions";
import { GUIDE_LAST_UPDATED, GUIDE_SECTIONS, type GuideSection } from "./guideContent";

const GREEN = "#4a5d0f";
const LIGHT = "#eef3c4";

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

interface SubHeading {
  id: string;
  text: string;
}

export default function UserGuideContent() {
  const { canRoute, isSuperAdmin } = usePermissions();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string>("");
  const articleRef = useRef<HTMLDivElement | null>(null);

  // Role-filtered sections: a section shows when the user can open at least one
  // of the routes it documents. Sections with no routeKeys are for everyone.
  const sections = useMemo<GuideSection[]>(
    () =>
      GUIDE_SECTIONS.filter((s) => {
        if (s.superAdminOnly && !isSuperAdmin) return false;
        if (!s.routeKeys || s.routeKeys.length === 0) return true;
        return s.routeKeys.some((r) => canRoute(r));
      }),
    [canRoute, isSuperAdmin],
  );

  const subHeadings = useMemo<Record<string, SubHeading[]>>(() => {
    const out: Record<string, SubHeading[]> = {};
    for (const section of sections) {
      const found: SubHeading[] = [];
      for (const line of section.body.split("\n")) {
        const match = /^###\s+(.+)$/.exec(line);
        if (match) {
          const text = match[1].trim();
          found.push({ id: slugify(text), text });
        }
      }
      out[section.id] = found;
    }
    return out;
  }, [sections]);

  const q = query.trim().toLowerCase();

  const tocSections = useMemo(() => {
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.body.toLowerCase().includes(q) ||
        (subHeadings[s.id] ?? []).some((h) => h.text.toLowerCase().includes(q)),
    );
  }, [sections, subHeadings, q]);

  // Highlight the section currently in view.
  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [sections]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));

  const handleDownload = () => {
    const markdown = [
      "# ACSL Stove Sales & Transactions Platform — User Guide",
      `_Last updated ${GUIDE_LAST_UPDATED}_`,
      "",
      ...sections.map((s) => `## ${s.title}\n\n${s.body}\n`),
    ].join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ACSL-Platform-User-Guide.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const markdownComponents = {
    h3: ({ children }: { children?: React.ReactNode }) => {
      const text = String(children);
      return (
        <h3
          id={slugify(text)}
          className="text-sm font-bold text-gray-900 mt-6 mb-2 scroll-mt-4"
        >
          {children}
        </h3>
      );
    },
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="text-sm font-semibold text-gray-800 mt-4 mb-1.5">{children}</h4>
    ),
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>
    ),
    hr: () => <hr className="my-6 border-gray-200" />,
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold text-gray-900">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic text-gray-600">{children}</em>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-2 border-[#4a5d0f] pl-3 italic text-gray-600 mb-3">
        {children}
      </blockquote>
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-xs border border-gray-200">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead style={{ backgroundColor: LIGHT }}>{children}</thead>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="text-left font-semibold px-2.5 py-1.5 border border-gray-200 text-[#4a5d0f]">
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-2.5 py-1.5 border border-gray-200 align-top">{children}</td>
    ),
    code: ({ children }: { children?: React.ReactNode }) => (
      <code className="font-mono text-[12px] px-1 py-0.5 rounded bg-gray-100 text-[#4a5d0f]">
        {children}
      </code>
    ),
  };

  return (
    <DashboardLayout currentRoute="user-guide" title="User Guide">
      <div className="space-y-4">
        <PageHeader
          title="User Guide"
          description={`Step-by-step instructions for the features available to your user group · last updated ${GUIDE_LAST_UPDATED}`}
          icon={HelpCircle}
          right={
            <Button onClick={handleDownload} className="text-white" style={{ backgroundColor: GREEN }}>
              <Download className="h-4 w-4 mr-2" />
              Download Guide
            </Button>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Dynamic table of contents */}
          <aside className="lg:sticky lg:top-4 lg:self-start bg-white border border-gray-200 rounded-lg p-3">
            <div className="relative mb-2">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the guide"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-1 mb-1">
              Contents
            </p>
            <nav className="space-y-0.5 max-h-[70vh] overflow-y-auto pr-1">
              {tocSections.map((section) => {
                const children = subHeadings[section.id] ?? [];
                const isActive = activeId === section.id;
                const isOpen = expanded[section.id] ?? (isActive || Boolean(q));
                return (
                  <div key={section.id}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => scrollTo(section.id)}
                        className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition-colors ${
                          isActive
                            ? "bg-[#4a5d0f] text-white font-medium"
                            : "text-gray-700 hover:bg-[#eef3c4] hover:text-[#4a5d0f]"
                        }`}
                      >
                        {section.title}
                      </button>
                      {children.length > 0 && (
                        <button
                          onClick={() => toggle(section.id)}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                          className="p-1 rounded text-gray-400 hover:text-[#4a5d0f] hover:bg-[#eef3c4]"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>

                    {isOpen && children.length > 0 && (
                      <div className="ml-3 pl-3 border-l border-gray-200 space-y-0.5 mt-0.5 mb-1">
                        {children.map((child) => (
                          <button
                            key={`${section.id}-${child.id}`}
                            onClick={() => scrollTo(child.id)}
                            className="w-full text-left text-[11px] px-2 py-1 rounded text-gray-600 hover:bg-[#eef3c4] hover:text-[#4a5d0f] transition-colors"
                          >
                            {child.text}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {tocSections.length === 0 && (
                <p className="text-xs text-gray-400 px-2 py-1.5">No match.</p>
              )}
            </nav>
          </aside>

          {/* Guide body */}
          <div ref={articleRef} className="space-y-4">
            {sections.map((section, index) => {
              const prev = sections[index - 1];
              const next = sections[index + 1];
              const figures = section.figures ?? [];
              // Split the body on {{figure:id}} tokens so screenshots sit with their steps.
              const parts = section.body.split(/\{\{figure:([a-z0-9-]+)\}\}/i);
              let figureNumber = 0;
              return (
                <article
                  key={section.id}
                  id={section.id}
                  className="bg-white border border-gray-200 rounded-lg p-6 scroll-mt-4"
                >
                  <h2
                    className="text-lg font-bold mb-3 pb-1.5 border-b border-gray-200"
                    style={{ color: GREEN }}
                  >
                    {section.title}
                  </h2>
                  <div className="doc-prose text-sm text-gray-700 leading-relaxed">
                    {parts.map((part, i) => {
                      if (i % 2 === 1) {
                        const figure = figures.find((f) => f.id === part);
                        if (!figure) return null;
                        figureNumber += 1;
                        return (
                          <GuideFigure
                            key={`${section.id}-fig-${part}`}
                            figure={figure}
                            index={figureNumber}
                          />
                        );
                      }
                      if (!part.trim()) return null;
                      return (
                        <ReactMarkdown
                          key={`${section.id}-md-${i}`}
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {part}
                        </ReactMarkdown>
                      );
                    })}
                  </div>


                  <div className="flex items-center justify-between gap-2 mt-6 pt-3 border-t border-gray-200">
                    {prev ? (
                      <button
                        onClick={() => scrollTo(prev.id)}
                        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-[#4a5d0f]"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        {prev.title}
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#4a5d0f]"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                      Top
                    </button>
                    {next ? (
                      <button
                        onClick={() => scrollTo(next.id)}
                        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-[#4a5d0f]"
                      >
                        {next.title}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
