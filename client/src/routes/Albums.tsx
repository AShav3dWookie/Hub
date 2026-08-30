import { Link } from "react-router-dom";
import { useAlbums } from "../api/hooks.js";

function dateRange(start: string | null, end: string | null): string | null {
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? null;
}

export function Albums() {
  const { data, isLoading } = useAlbums();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Albums</h1>

      {isLoading && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <p className="text-slate-500 dark:text-slate-400">
          No albums yet — create one from the Add screen.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {data?.map((album) => {
          const range = dateRange(album.dateStart, album.dateEnd);
          return (
            <li key={album.id}>
              <Link
                to={`/album/${album.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                <span className="flex flex-col">
                  <span className="text-lg font-medium dark:text-white">{album.title}</span>
                  {range && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{range}</span>
                  )}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {album.eventCount} event{album.eventCount === 1 ? "" : "s"} · {album.photoCount} photo
                  {album.photoCount === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
