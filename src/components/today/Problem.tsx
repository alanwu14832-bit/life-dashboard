

export function Problem({ error, hint }: { error: string; hint?: string }) {
  return (
    <p className="block-problem">
      {error}
      {hint && <span>{hint}</span>}
    </p>
  );
}
