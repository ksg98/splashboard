import { Link } from 'react-router';

export function NotFound() {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-fg-muted">
        Nothing lives at this address. <Link to="/">Go home</Link>
      </p>
    </section>
  );
}
