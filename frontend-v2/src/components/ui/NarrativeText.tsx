function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-surface-100">{part.slice(2, -2)}</strong>
      : part
  );
}

// Renders multi-paragraph narrative text with minimal **bold** markdown
// support. Used for AI-generated analysis content.
export function NarrativeText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-surface-300 leading-relaxed">{renderBold(para)}</p>
      ))}
    </div>
  );
}
