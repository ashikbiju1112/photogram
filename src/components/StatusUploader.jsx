import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";

export default function StatusUploader() {
  const { user } = useAuth();

  async function uploadStatus(file) {
    const path = `${user.id}/${Date.now()}.jpg`;

    await supabase.storage
      .from("stories")
      .upload(path, file);

    const { data } = supabase
      .storage
      .from("stories")
      .getPublicUrl(path);

    await supabase.from("stories").insert({
      user_id: user.id,
      media_url: data.publicUrl,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }

  return (
    <input
      type="file"
      accept="image/*"
      onChange={e => uploadStatus(e.target.files[0])}
    />
  );
}
