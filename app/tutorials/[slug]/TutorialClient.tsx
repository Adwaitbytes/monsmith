"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export function TutorialClient() {
  const params = useParams();
  const slug = params.slug as string;
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadTutorial = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/tutorial?slug=${slug}`);
        const data: { success: boolean; content?: string } = await res.json();
        if (cancelled) return;
        setContent(
          data.success && data.content
            ? data.content
            : "# Tutorial Not Found\n\nThe requested tutorial could not be loaded."
        );
      } catch {
        if (!cancelled) setContent("# Error\n\nFailed to load tutorial.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadTutorial();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Tutorial markdown is repo-owned, but the inline formatter builds raw HTML -   // escape first so a stray angle bracket can never become live markup.
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const inlineFormat = (text: string) =>
    escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-text-primary">$1</strong>')
      .replace(/`(.+?)`/g, '<code class="bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1 py-0.5 rounded text-sm font-mono">$1</code>');

  const processContent = () => {
    const lines = content.split('\n');
    const elements: React.ReactElement[] = [];
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let codeBlockLang = '';

    lines.forEach((line, i) => {
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.slice(3);
          codeBlockContent = [];
        } else {
          inCodeBlock = false;
          elements.push(
            <pre key={`code-${i}`} className="relative panel-sunken border border-border-subtle rounded-lg p-4 overflow-x-auto my-4">
              {codeBlockLang && (
                <span className="absolute top-2 right-3 text-[10px] uppercase tracking-wider text-text-muted">
                  {codeBlockLang}
                </span>
              )}
              <code className="text-sm font-mono text-text-primary">{codeBlockContent.join('\n')}</code>
            </pre>
          );
          codeBlockContent = [];
        }
        return;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        return;
      }

      // Headers
      if (line.startsWith('### ')) {
        elements.push(<h3 key={i} className="text-xl font-bold mt-6 mb-3 text-purple-600 dark:text-purple-400">{line.slice(4)}</h3>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={i} className="text-2xl font-bold mt-8 mb-4 text-purple-700 dark:text-purple-300">{line.slice(3)}</h2>);
      } else if (line.startsWith('# ')) {
        elements.push(<h1 key={i} className="text-4xl font-bold mb-6 text-text-primary">{line.slice(2)}</h1>);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        // List items
        const processed = inlineFormat(line.slice(2));
        elements.push(
          <li key={i} className="text-text-primary ml-6 mb-2 list-disc" dangerouslySetInnerHTML={{ __html: processed }} />
        );
      } else if (!line.trim()) {
        elements.push(<br key={i} />);
      } else {
        // Regular paragraph
        const processed = inlineFormat(line);
        elements.push(<p key={i} className="text-text-secondary leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: processed }} />);
      }
    });

    return elements;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-text-primary flex items-center justify-center">
        <div className="animate-pulse text-text-secondary">Loading tutorial...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-text-primary">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      </div>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-purple-600/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="inline-flex items-center gap-2 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:text-purple-300 mb-8 text-sm font-bold">
          ← Back to Monsmith
        </Link>

        <div className="panel-surface border border-border-subtle rounded-3xl p-8 md:p-12 shadow-[var(--shadow-panel)]">
          {processContent()}
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-bold transition-all">
            Try in Monsmith
          </Link>
        </div>
      </div>
    </div>
  );
}
