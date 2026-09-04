import { useState } from "react";
import { FIELD_CLASS, PRIMARY_BUTTON_CLASS } from "../components/ui.js";
import { useNavigate } from "react-router-dom";
import { useCreateEntity } from "../api/hooks.js";
import { useToast } from "../components/ToastProvider.js";
import { useOnlineStatus } from "../api/localHooks.js";

export function PersonAddForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineStatus();
  const createEntity = useCreateEntity();
  const navigate = useNavigate();
  const { showToast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    try {
      await createEntity.mutateAsync({ category: "person", title: name.trim() });
      navigate("/");
      showToast(online ? "Saved!" : "Saved — will sync when you're back online.");
    } catch {
      setError("Failed to create person");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={FIELD_CLASS}
          autoFocus
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={createEntity.isPending}
        className={PRIMARY_BUTTON_CLASS}
      >
        Create person
      </button>
    </form>
  );
}
