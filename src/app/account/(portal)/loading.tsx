export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-9 w-56 rounded-lg bg-ink/[0.06]" />
      <div className="card h-72 bg-white" />
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="card h-56 bg-white" />
        <div className="card h-56 bg-white" />
        <div className="card h-56 bg-white" />
      </div>
    </div>
  );
}
