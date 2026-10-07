import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

/** Last-resort error screen for anything a feature route throws. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <section className="p-6" role="alert">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-sm text-danger">{message}</pre>
      <p className="mt-4">
        <Link to="/">Back to start</Link>
      </p>
    </section>
  );
}
