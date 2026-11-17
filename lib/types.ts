export type Role = 'marketing' | 'ops' | 'member';

export const ROLE_LABELS: Record<Role, string> = {
  marketing: 'Marketing (Kori)',
  ops: 'Ops',
  member: 'Team member',
};

export interface Person {
  id: number;
  name: string;
  email: string | null;
  role: Role;
  isAdmin: boolean;
  active: boolean;
}

export interface Link {
  label: string;
  url: string;
}

export interface Step {
  id: number;
  versionId: number;
  key: StepKey;
  assigneeId: number | null;
  dueDate: string; // YYYY-MM-DD
  dueTime: string | null; // HH:mm Eastern, optional
  dueOverridden: boolean;
  completedById: number | null;
  completedAt: string | null; // ISO timestamp
  changesRequested: boolean;
  changesNote: string | null;
}

export interface Version {
  id: number;
  emailId: number;
  name: string;
  audience: string;
  exclusions: string;
  subject: string;
  preheader: string;
  links: Link[];
  previewUrl: string;
  notes: string;
  ownerId: number | null;
  sortOrder: number;
  city: string; // launch city this version goes to (used for launch delays)
  steps: Step[];
}

export interface Email {
  id: number;
  title: string;
  sendDate: string;
  sendTime: string | null;
  isLaunch: boolean; // labeled "Launch email"
  versions: Version[];
}

export interface RescheduleSuggestion {
  id: number;
  delayId: number;
  emailId: number | null;
  emailTitle: string;
  versionIds: number[];
  versionNames: string[];
  currentSendDate: string;
  suggestedDate: string;
  movedOffWeekend: boolean;
  plan: 'move' | 'split';
  status: 'pending' | 'approved' | 'declined';
  finalDate: string | null;
  decidedById: number | null;
  decidedAt: string | null;
  note: string | null;
}

export interface LaunchDelay {
  id: number;
  city: string;
  oldLaunchDate: string;
  newLaunchDate: string;
  reason: string;
  reportedById: number | null;
  createdAt: string;
  suggestions: RescheduleSuggestion[];
}

export interface Activity {
  id: number;
  emailId: number;
  versionId: number | null;
  personId: number | null;
  kind: string;
  message: string;
  createdAt: string;
}

export interface AppState {
  me: Person;
  people: Person[];
  emails: Email[];
  delays: LaunchDelay[];
  serverTime: string;
}

export type StepKey =
  | 'design_submitted'
  | 'audiences_submitted'
  | 'design_approved_1'
  | 'design_approved_2'
  | 'audience_approved_1'
  | 'audience_approved_2'
  | 'email_sent';
