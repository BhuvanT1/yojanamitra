import { Masthead } from './Masthead';

/**
 * Kept as the name every non-search page already imports; the portal masthead is
 * what it renders. No hooks, so it works unchanged in server and client
 * components alike.
 */
export function SimpleHeader({
  locale,
  sub,
  children,
}: {
  locale: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <Masthead locale={locale} section={sub} breadcrumb={sub}>
      {children}
    </Masthead>
  );
}
