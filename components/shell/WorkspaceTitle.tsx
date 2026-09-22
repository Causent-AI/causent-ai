"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const WorkspaceTitleContext = createContext<{
  title: string;
  setTitle: (title: string) => void;
} | null>(null);

export function WorkspaceTitleProvider({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [override, setTitle] = useState("");
  return (
    <WorkspaceTitleContext.Provider
      value={{ title: override || title, setTitle }}
    >
      {children}
    </WorkspaceTitleContext.Provider>
  );
}

export function useWorkspaceTitle() {
  return useContext(WorkspaceTitleContext);
}

export function ReportTitleSync({ title }: { title: string }) {
  const context = useWorkspaceTitle();
  const setTitle = context?.setTitle;
  useEffect(() => {
    setTitle?.(title);
    return () => setTitle?.("");
  }, [setTitle, title]);
  return null;
}
