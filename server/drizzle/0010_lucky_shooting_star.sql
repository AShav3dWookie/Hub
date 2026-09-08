-- `log_photos` carries its own row_seq (it is a synced table in its own right), but nothing
-- ever bumped the *log* it hangs off. `LogSyncDTO.photoIds` is built from that link, so a
-- client that had already synced past a log kept the `photoIds: []` it was first sent: photos
-- vanished from the entity page while still showing in the gallery, which reads photos
-- directly. Same reasoning as the `log_people` / `album_events` triggers in 0007 — touch the
-- parent's `updated_at` so its own AFTER UPDATE trigger claims a fresh row_seq and the delta
-- feed re-emits it with a correct array.
CREATE TRIGGER `log_photos_parent_ai` AFTER INSERT ON `log_photos` BEGIN
  UPDATE `logs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = NEW.`log_id`;
END;--> statement-breakpoint
CREATE TRIGGER `log_photos_parent_ad` AFTER DELETE ON `log_photos` BEGIN
  UPDATE `logs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = OLD.`log_id`;
END;--> statement-breakpoint

-- A photo moving between logs, and in particular `log_id` being nulled by ON DELETE SET NULL
-- when a log is deleted but its photos survive as gallery orphans. Both sides are bumped;
-- `WHERE id = OLD.log_id` is a harmless no-op when that log is itself being deleted.
CREATE TRIGGER `log_photos_parent_au` AFTER UPDATE OF `log_id` ON `log_photos` BEGIN
  UPDATE `logs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = OLD.`log_id`;
  UPDATE `logs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE `id` = NEW.`log_id`;
END;--> statement-breakpoint

-- The triggers only fix writes from here on. Every log that already has photos is sitting at a
-- row_seq every synced client is long past, so without this their photos would stay missing
-- forever — and there is no "reset local data" for a user to fall back on. Assigning
-- `updated_at` to itself changes nothing but still fires `logs_sync_au`, which allocates a
-- fresh row_seq and re-sends the log with its real photoIds on the next pull.
UPDATE `logs` SET `updated_at` = `updated_at`
WHERE `id` IN (SELECT DISTINCT `log_id` FROM `log_photos` WHERE `log_id` IS NOT NULL);
