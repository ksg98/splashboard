import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './router';
import { ThemeProvider } from './theme/ThemeProvider';

export function App() {
  const [router] = useState(createAppRouter);
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
