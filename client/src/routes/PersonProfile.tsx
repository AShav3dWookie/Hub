import { useParams, Navigate, Link } from "react-router-dom";
import { CATEGORY_META } from "@logger/shared";
import { useEntityDetail } from "../api/hooks.js";
import { StarRating } from "../components/StarRating.js";
import { EntityNotes } from "../components/EntityNotes.js";

export function PersonProfile() {
  const { id } = useParams<{ id: string }>();
  const personId = Number(id);
  const { data, isLoading } = useEntityDetail(personId);

  if (isLoading) return <p className="text-slate-500 dark:text-slate-400">Loading…</p>;
  if (!data) return <p className="text-slate-500 dark:text-slate-400">Not found.</p>;
  if (data.type === "entity") return <Navigate to={`/entity/${personId}`} replace />;

  const { entity, appearances, stats } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{entity.title}</h1>
        <p className="text-slate-500 dark:text-slate-400">
          {stats.totalLogs} log{stats.totalLogs === 1 ? "" : "s"}
          {stats.favoriteCategory && ` · favorite: ${CATEGORY_META[stats.favoriteCategory].label}`}
          {stats.mostFrequentCoPerson && (
            <>
              {" "}
              · most often with{" "}
              <Link to={`/person/${stats.mostFrequentCoPerson.id}`} className="hover:underline">
                {stats.mostFrequentCoPerson.name}
              </Link>
            </>
          )}
        </p>
      </div>

      <EntityNotes entityId={personId} />

      <div className="flex flex-col gap-3">
        {appearances.length === 0 && <p className="text-slate-500 dark:text-slate-400">No appearances yet.</p>}
        {appearances.map((log) => (
          <div
            key={log.id}
            className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <Link to={`/entity/${log.entity.id}`} className="font-medium hover:underline dark:text-white">
                {log.entity.title}
              </Link>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {CATEGORY_META[log.entity.category].label} · {log.date}
              </span>
            </div>
            <StarRating value={log.rating} readOnly />
            {log.notes && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{log.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
