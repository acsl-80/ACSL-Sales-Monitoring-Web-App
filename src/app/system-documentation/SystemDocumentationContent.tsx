import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Download, Search } from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import PageHeader from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { APP_DOCUMENTATION, DOC_LAST_UPDATED } from "./appDocumentation";

const GREEN = "#4a5d0f";

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

interface Heading {
  id: string;
  text: string;
}

export default function SystemDocumentationContent() {
  const [query, setQuery] = useState("");

  const headings = useMemo<Heading[]>(() => {
    const out: Heading[] = [];
    for (const line of APP_DOCUMENTATION.split("\n")) {
      const match = /^##\s+(.+)$/.exec(line);
      if (match) {
        const text = match[1].trim();
        out.push({ id: slugify(text), text });
      }
    }
    return out;
  }, []);

  const filteredHeadings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return headings;
    return headings.filter((h) => h.text.toLowerCase().includes(q));
  }, [headings, query]);

  const handleDownload = () => {
    const blob = new Blob([APP_DOCUMENTATION], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ACSL-Platform-Handover-Documentation.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <DashboardLayout currentRoute="system-documentation" title="App Documentation">
      <div className="space-y-4">
        <PageHeader
          title="App Documentation"
          description={`Technical documentation for this application · last updated ${DOC_LAST_UPDATED}`}
          icon={BookOpen}
          right={
            <Button
              onClick={handleDownload}
              className="text-white"
              style={{ backgroundColor: GREEN }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download Markdown
            </Button>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Contents */}
          <aside className="lg:sticky lg:top-4 lg:self-start bg-white border border-gray-200 rounded-lg p-3">
            <div className="relative mb-2">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a section"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 px-1 mb-1">
              Contents
            </p>
            <nav className="space-y-0.5 max-h-[70vh] overflow-y-auto pr-1">
              {filteredHeadings.map((h) => (
                <button
                  key={h.id}
                  onClick={() => scrollTo(h.id)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded text-gray-700 hover:bg-[#eef3c4] hover:text-[#4a5d0f] transition-colors"
                >
                  {h.text}
                </button>
              ))}
              {filteredHeadings.length === 0 && (
                <p className="text-xs text-gray-400 px-2 py-1.5">No match.</p>
              )}
            </nav>
          </aside>

          {/* Document */}
          <article className="bg-white border border-gray-200 rounded-lg p-6 overflow-x-auto">
            <div className="doc-prose text-sm text-gray-700 leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold text-gray-900 mb-3">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => {
                    const text = String(children);
                    return (
                      <h2
                        id={slugify(text)}
                        className="text-lg font-bold mt-8 mb-3 pb-1.5 border-b border-gray-200 scroll-mt-4"
                        style={{ color: GREEN }}
                      >
                        {children}
                      </h2>
                    );
                  },
                  h3: ({ children }) => (
                    <h3 className="text-sm font-bold text-gray-900 mt-5 mb-2">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => <p className="mb-3">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-5 mb-3 space-y-1">
                      {children}
                    </ol>
                  ),
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      className="text-[#4a5d0f] underline underline-offset-2"
                    >
                      {children}
                    </a>
                  ),
                  hr: () => <hr className="my-6 border-gray-200" />,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-gray-900">
                      {children}
                    </strong>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-[#4a5d0f] pl-3 italic text-gray-600 mb-3">
                      {children}
                    </blockquote>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto mb-4">
                      <table className="w-full text-xs border border-gray-200">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead style={{ backgroundColor: "#eef3c4" }}>
                      {children}
                    </thead>
                  ),
                  th: ({ children }) => (
                    <th className="text-left font-semibold px-2.5 py-1.5 border border-gray-200 text-[#4a5d0f]">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-2.5 py-1.5 border border-gray-200 align-top">
                      {children}
                    </td>
                  ),
                  code: ({ className, children }) => {
                    const isBlock = Boolean(className);
                    if (isBlock) {
                      return (
                        <code className="block whitespace-pre font-mono text-[11px] leading-5">
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code className="font-mono text-[12px] px-1 py-0.5 rounded bg-gray-100 text-[#4a5d0f]">
                        {children}
                      </code>
                    );
                  },
                  pre: ({ children }) => (
                    <pre className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-4 overflow-x-auto">
                      {children}
                    </pre>
                  ),
                }}
              >
                {APP_DOCUMENTATION}
              </ReactMarkdown>
            </div>
          </article>
        </div>
      </div>
    </DashboardLayout>
  );
}
