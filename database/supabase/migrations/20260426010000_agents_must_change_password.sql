-- Add must_change_password flag to agents.
-- Default true: new rows (admin-created via CLI) require a change on first login.
-- Existing rows pick up the default; demo agents are set back to false below
-- so partners can log in as alice/bob/etc. without password-change friction.

alter table public.agents
  add column if not exists must_change_password boolean not null default true;

update public.agents
   set must_change_password = false
 where email like '%@crestline.com';

comment on column public.agents.must_change_password is
  'True if the agent must change their password before accessing protected routes. Set by admin-create-agent CLI and admin-set-password CLI; cleared by /api/auth/change-password.';
