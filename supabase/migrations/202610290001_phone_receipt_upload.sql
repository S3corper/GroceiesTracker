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
  p_operation text,
  p_token text default null,
  p_space_id uuid default null,
  p_mime_type text default null,
  p_image_base64 text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); session public.grocery_phone_upload_sessions;
begin
  if p_operation='create' then
    if uid is null or not public.grocery_is_member(p_space_id) then
      raise exception 'Workspace access denied.' using errcode='42501';
    end if;
    delete from public.grocery_phone_upload_sessions where expires_at<=now() or consumed_at is not null;
    delete from public.grocery_phone_upload_sessions where user_id=uid and space_id=p_space_id;
    p_token := replace(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'-','');
    insert into public.grocery_phone_upload_sessions(token,user_id,space_id,expires_at)
      values(p_token,uid,p_space_id,now()+interval '5 minutes') returning * into session;
    return jsonb_build_object('token',session.token,'expiresAt',session.expires_at);
  elsif p_operation='status' then
    select * into session from public.grocery_phone_upload_sessions where token=p_token;
    if session.token is null or session.expires_at<=now() or session.consumed_at is not null then
      raise exception 'The link no longer works. Please try again with a new QR Code.';
    end if;
    return jsonb_build_object('status',case when session.uploaded_at is null then 'waiting' else 'uploaded' end,'expiresAt',session.expires_at);
  elsif p_operation='upload' then
    select * into session from public.grocery_phone_upload_sessions where token=p_token for update;
    if session.token is null or session.expires_at<=now() or session.consumed_at is not null then
      raise exception 'The link no longer works. Please try again with a new QR Code.';
    end if;
    if session.uploaded_at is not null then raise exception 'This link has already been used. Please scan a new QR Code.'; end if;
    if p_mime_type is null or p_image_base64 is null or p_mime_type not in ('image/jpeg','image/png','image/webp') or p_image_base64 !~ '^[A-Za-z0-9+/]+=*$' or length(p_image_base64)>5592408 then
      raise exception 'Choose a JPG, PNG, or WebP receipt photo under 4 MB.';
    end if;
    update public.grocery_phone_upload_sessions set mime_type=p_mime_type,image_base64=p_image_base64,uploaded_at=now()
      where token=p_token;
    return jsonb_build_object('status','uploaded');
  elsif p_operation='consume' then
    if uid is null then raise exception 'Sign in to access your household.' using errcode='42501'; end if;
    select * into session from public.grocery_phone_upload_sessions where token=p_token for update;
    if session.token is null or session.user_id<>uid or session.expires_at<=now() or session.consumed_at is not null then
      raise exception 'The link no longer works. Please try again with a new QR Code.';
    end if;
    if session.uploaded_at is null then raise exception 'No receipt photo has been uploaded yet.'; end if;
    update public.grocery_phone_upload_sessions set consumed_at=now(),image_base64=null where token=p_token;
    return jsonb_build_object('mimeType',session.mime_type,'imageBase64',session.image_base64);
  end if;
  raise exception 'Unsupported phone upload operation.';
end;
$$;
revoke all on function public.grocery_phone_upload(text,text,uuid,text,text) from public;
grant execute on function public.grocery_phone_upload(text,text,uuid,text,text) to anon, authenticated;
