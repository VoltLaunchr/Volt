import { useEffect, useState } from 'react';
import { AppWindow } from 'lucide-react';
import { loadAppIcon } from '../../services/appIconService';

/** Mount only for displayed results: scanning the catalog must not hydrate every icon. */
export function ApplicationIcon({ path, icon }: { path: string; icon?: string }) {
  const [loaded, setLoaded] = useState<{ path: string; icon: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const src = icon ?? (loaded?.path === path ? loaded.icon : undefined);
  useEffect(() => {
    if (icon || !path) return;
    let cancelled = false;
    void loadAppIcon(path).then((value) => {
      if (!cancelled && value) setLoaded({ path, icon: value });
    });
    return () => {
      cancelled = true;
    };
  }, [path, icon]);
  return src && failed !== src ? (
    <img
      src={src}
      alt=""
      decoding="async"
      className="w-8 h-8 object-contain shrink-0 rounded-md"
      onError={() => setFailed(src)}
    />
  ) : (
    <div className="flex items-center justify-center w-8 h-8 shrink-0 text-mute">
      <AppWindow size={20} />
    </div>
  );
}
