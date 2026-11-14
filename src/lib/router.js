import React from 'react';

// Tiny hash router. Paths look like `#/cameras` or `#/live/front?state=reconnecting`.

function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function useRoute() {
  const [route, setRoute] = React.useState(parse);
  React.useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const href = (path) => `#${path}`;

export function navigate(path, { replace = false } = {}) {
  if (replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}
