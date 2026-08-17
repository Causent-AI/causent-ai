"use client";

import type { Editor } from "@tiptap/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ActiveDocumentEditor = {
  editor: Editor;
  claimId: string;
  label: string;
};

type DocumentEditorContextValue = {
  active: ActiveDocumentEditor | null;
  activate: (active: ActiveDocumentEditor) => void;
  deactivate: (editor: Editor) => void;
};

const DocumentEditorContext = createContext<DocumentEditorContextValue | null>(
  null,
);

export function DocumentEditorProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDocumentEditor | null>(null);
  const activate = useCallback((next: ActiveDocumentEditor) => {
    setActive(next);
  }, []);
  const deactivate = useCallback((editor: Editor) => {
    setActive((current) => (current?.editor === editor ? null : current));
  }, []);
  const value = useMemo(
    () => ({ active, activate, deactivate }),
    [active, activate, deactivate],
  );

  return (
    <DocumentEditorContext.Provider value={value}>
      {children}
    </DocumentEditorContext.Provider>
  );
}

export function useDocumentEditor(): DocumentEditorContextValue {
  const value = useContext(DocumentEditorContext);
  if (!value) {
    throw new Error(
      "Rich report fields must render inside DocumentEditorProvider.",
    );
  }
  return value;
}
