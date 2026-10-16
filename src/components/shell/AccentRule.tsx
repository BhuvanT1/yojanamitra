/**
 * The tricolour accent rule.
 *
 * Three solid bands and nothing else. It is the one visual convention this
 * project borrows from Indian public-service portals, because it reads as
 * "civic" without asserting anything — and it is deliberately the ONLY such
 * borrowing. No State Emblem, no "Government of India" lockup, no ministry
 * mark, on any page, ever.
 *
 * Lives in one file so that line stays easy to hold: if someone ever needs to
 * change what the accent is, there is a single place to change it, and a single
 * place where the reason is written down.
 */
export function AccentRule({ className = '' }: { className?: string }) {
  return (
    <div className={`flex h-[3px] ${className}`} aria-hidden="true">
      <span className="flex-1 bg-saffron" />
      <span className="flex-1 bg-paper" />
      <span className="flex-1 bg-india-green" />
    </div>
  );
}
