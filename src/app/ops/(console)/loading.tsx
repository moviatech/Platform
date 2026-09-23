export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-7 h-8 w-48 rounded-lg bg-ink/[0.06]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card h-24" />
        <div className="card h-24" />
        <div className="card h-24" />
        <div className="card h-24" />
      </div>
      <div className="card mt-5 h-72" />
    </div>
  );
}
