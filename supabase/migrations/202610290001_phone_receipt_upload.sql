create table if not exists public.grocery_phone_upload_sessions (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.grocery_spaces(id) on delete cascade,
  expires_at timestamptz not null,
  mime_type text,
  image_base64 text,
  uploaded_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.grocery_phone_upload_sessions enable row level security;
revoke all on public.grocery_phone_upload_sessions from public, anon, authenticated;

create or replace function public.grocery_phone_upload(
  operation text,
  token text default null,
  space_id uuid default null,
  mime_type text default null,
  image_base64 text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); session public.grocery_phone_upload_sessions;
begin
  if operation='create' then
    if uid is null or not public.grocery_is_member(space_id) then
      raise exception 'Workspace access denied.' using errcode='42501';
    end if;
    delete from public.grocery_phone_upload_sessions where expires_at<=now() or consumed_at is not null;
    delete from public.grocery_phone_upload_sessions where user_id=uid and grocery_phone_upload_sessions.space_id=grocery_phone_upload.space_id;
    token := replace(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'-','');
    insert into public.grocery_phone_upload_sessions(token,user_id,space_id,expires_at)
      values(token,uid,space_id,now()+interval '5 minutes') returning * into session;
    return jsonb_build_object('token',session.token,'expiresAt',session.expires_at);
  elsif operation='status' then
    select * into session from public.grocery_phone_upload_sessions where grocery_phone_upload_sessions.token=grocery_phone_upload.token;
    if session.token is null or session.expires_at<=now() or session.consumed_at is not null then
      raise exception 'The link no longer works. Please try again with a new QR Code.';
    end if;
    return jsonb_build_object('status',case when session.uploaded_at is null then 'waiting' else 'uploaded' end,'expiresAt',session.expires_at);
  elsif operation='upload' then
    select * into session from public.grocery_phone_upload_sessions where grocery_phone_upload_sessions.token=grocery_phone_upload.token for update;
    if session.token is null or session.expires_at<=now() or session.consumed_at is not null then
      raise exception 'The link no longer works. Please try again with a new QR Code.';
    end if;
    if session.uploaded_at is not null then raise exception 'This link has already been used. Please scan a new QR Code.'; end if;
    if mime_type not in ('image/jpeg','image/png','image/webp') or image_base64 !~ '^[A-Za-z0-9+/]+=*$' or length(image_base64)>5592408 then
      raise exception 'Choose a JPG, PNG, or WebP receipt photo under 4 MB.';
    end if;
    update public.grocery_phone_upload_sessions set mime_type=grocery_phone_upload.mime_type,image_base64=grocery_phone_upload.image_base64,uploaded_at=now()
      where grocery_phone_upload_sessions.token=grocery_phone_upload.token;
    return jsonb_build_object('status','uploaded');
  elsif operation='consume' then
    if uid is null then raise exception 'Sign in to access your household.' using errcode='42501'; end if;
    select * into session from public.grocery_phone_upload_sessions where grocery_phone_upload_sessions.token=grocery_phone_upload.token for update;
    if session.token is null or session.user_id<>uid or session.expires_at<=now() or session.consumed_at is not null then
      raise exception 'The link no longer works. Please try again with a new QR Code.';
    end if;
    if session.uploaded_at is null then raise exception 'No receipt photo has been uploaded yet.'; end if;
    update public.grocery_phone_upload_sessions set consumed_at=now(),image_base64=null where grocery_phone_upload_sessions.token=grocery_phone_upload.token;
    return jsonb_build_object('mimeType',session.mime_type,'imageBase64',session.image_base64);
  end if;
  raise exception 'Unsupported phone upload operation.';
end;
$$;
revoke all on function public.grocery_phone_upload(text,text,uuid,text,text) from public;
grant execute on function public.grocery_phone_upload(text,text,uuid,text,text) to anon, authenticated;
