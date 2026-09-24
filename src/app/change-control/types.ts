// Shared shapes for the Change Control screens (slice S8c). Every field here
// is one the change-request-intake edge function actually sends or accepts —
// see supabase/functions/change-request-intake/index.ts's header for the
// contract this mirrors. Nothing is invented.

export type ChangeControlOption = {
  key: string;
  label: string;
  description?: string | null;
  meta?: Record<string, unknown> | null;
};

export type ChangeControlAttachmentSettings = {
  max_files: number;
  max_mb: number;
  max_per_request: number;
  mime_types: string[];
};

export type ChangeControlForm = {
  open: boolean;
  attachments: ChangeControlAttachmentSettings;
  lists: {
    type: ChangeControlOption[];
    impact: ChangeControlOption[];
    app: ChangeControlOption[];
    module: ChangeControlOption[];
  };
};

export type ThreadAuthor = "you" | "team" | "reviewer" | "system";
export type ThreadKind = "comment" | "status_note" | "merge_note";

export type ThreadItem = {
  id: string;
  at: string;
  kind: ThreadKind;
  body: string;
  from: ThreadAuthor;
  status_to?: string | null;
};

// The seven statuses change-request-intake can hand back, kept as a literal
// union so a typo in a status key is a compile error rather than a blank chip.
export type ChangeControlStatus =
  | "new"
  | "needs_info"
  | "not_started"
  | "in_progress"
  | "fixed"
  | "still_open"
  | "closed";

export type ChangeControlStatusTone =
  | "new"
  | "info"
  | "queued"
  | "progress"
  | "fixed"
  | "reopen"
  | "closed";

// The list action's contract names a `files` array on a request but does not
// pin down one file's own shape beyond "files" (see the edge function's
// header). This is read defensively in components/FileGallery.tsx across the
// field names an attachment row is known to carry on the ERP side.
export type ChangeControlFile = {
  id?: string;
  comment_id?: string | null;
  file_name?: string;
  name?: string;
  mime_type?: string;
  type?: string;
  url?: string;
  signed_url?: string;
  download_url?: string;
  size_bytes?: number;
};

export type ChangeControlRequest = {
  id: string;
  ref: string;
  title: string;
  what_happened: string;
  what_expected: string | null;
  type: string;
  type_label: string;
  app: string;
  app_label: string;
  module: string | null;
  module_label: string | null;
  page_url?: string | null;
  impact: string;
  impact_label: string;
  status: ChangeControlStatus;
  status_label: string;
  status_tone: ChangeControlStatusTone;
  close_reason: string | null;
  via: string;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
  limited: boolean;
  merged_into: string | null;
  summary: string | null;
  files: ChangeControlFile[];
  thread: ThreadItem[];
};

export type RaiseRequestInput = {
  title: string;
  what_happened: string;
  what_expected?: string;
  type: string;
  app: string;
  module?: string;
  page_url?: string;
  impact: string;
  context?: Record<string, unknown>;
};

export type RaiseRequestResult = { id: string; ref: string; status: ChangeControlStatus };
export type ReplyResult = { id: string; at: string; status: ChangeControlStatus };
export type ConfirmResult = { status: ChangeControlStatus; close_reason: string | null };
export type UploadResult = { attached: number };

// A screenshot picked in the browser but not yet uploaded.
export type PendingFile = {
  id: string;
  file: File;
  previewUrl: string;
  width?: number;
  height?: number;
};
