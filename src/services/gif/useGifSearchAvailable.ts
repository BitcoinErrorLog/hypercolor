import { useEffect, useState } from 'react';
import { fetchGifConfig } from './GifProxyClient';

/** False until `/api/gif/config` reports search is configured. Fail closed. */
export function useGifSearchAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchGifConfig().then(value => {
      if (!cancelled) setAvailable(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}
