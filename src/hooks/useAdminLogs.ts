// src/hooks/useAdminLogs.ts
import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";

export const useAdminLogs = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      const { data } = await supabase
        .from("admin_logs")
        .select("*")
        .order("created_at", { ascending: false });

      setLogs(data || []);
      setLoading(false);
    };

    fetchLogs();
  }, []);

  return { logs, loading };
};
