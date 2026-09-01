import { useGallery, useDeleteGalleryPhoto } from "../api/hooks.js";
import { useOnlineStatus } from "../api/localHooks.js";
import { PhotoStream } from "../components/PhotoStream.js";
import { useToast } from "../components/ToastProvider.js";

export function Gallery() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useGallery();
  const deletePhoto = useDeleteGalleryPhoto();
  const { showToast } = useToast();
  const online = useOnlineStatus();

  const photos = data?.pages.flatMap((page) => page.photos) ?? [];

  async function handleDelete(photoId: number) {
    try {
      await deletePhoto.mutateAsync(photoId);
      showToast("Photo deleted");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete photo");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Gallery</h1>
      <PhotoStream
        photos={photos}
        isLoading={isLoading}
        hasNextPage={Boolean(hasNextPage)}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        emptyText="No photos yet — add some from a movie or a meal."
        onDelete={online ? handleDelete : undefined}
      />
    </div>
  );
}
