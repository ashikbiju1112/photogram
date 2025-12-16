// src/hooks/useAdminMessages.ts
//import { supabase } from "../integrations/supabase/client";
import { supabase } from "../lib/supabase";

export const useAdminMessages = () => {
  const deleteMessageAsAdmin = async (
    messageId: string
  ): Promise<void> => {
    await supabase
      .from("messages")
      .update({
        deleted_by_admin: true,
        deleted_at: new Date().toISOString(),
        content: "⚠️ Message removed by admin",
      })
      .eq("id", messageId);

    await supabase.from("admin_logs").insert({
      action: "DELETE_MESSAGE",
      target_id: messageId,
    });
  };

  return { deleteMessageAsAdmin };
};
