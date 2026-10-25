-- Run on a NEW Supabase Free project. Existing local SQLite data is imported
-- through the application's backup/restore flow; never upload passwords.
create schema if not exists grocery_private;
revoke all on schema grocery_private from public, anon, authenticated;

create table public.grocery_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (length(display_name) between 1 and 60),
  profile_image text not null default '' check (length(profile_image) <= 1400000)
);
create table public.grocery_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  kind text not null check (kind in ('private','household')),
  timezone text not null default 'America/New_York',
  owner_id uuid not null references auth.users(id),
  settings jsonb not null default '{"budget":null,"goal":null}',
  revision bigint not null default 0
);
create table public.grocery_memberships (
  space_id uuid not null references public.grocery_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key(space_id,user_id)
);
create table grocery_private.invitations (
  token text primary key default replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  space_id uuid not null references public.grocery_spaces(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);
create table public.grocery_receipts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.grocery_spaces(id) on delete cascade,
  merchant text not null check (length(merchant) <= 300),
  total numeric not null check (total >= 0 and total < 100000000),
  purchase_date date not null,
  purchase_time time,
  timezone text,
  purchase_instant timestamptz,
  photo_path text,
  items jsonb not null default '[]' check (jsonb_typeof(items)='array' and jsonb_array_length(items)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.grocery_receipts(space_id,purchase_date desc);
create index on public.grocery_memberships(user_id);
create table public.grocery_list_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.grocery_spaces(id) on delete cascade,
  name text not null check(length(name) between 1 and 300),
  created_at timestamptz not null default now()
);
create table grocery_private.photo_cleanup (
  path text primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create function public.grocery_is_member(sid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.grocery_memberships where space_id=sid and user_id=(select auth.uid()));
$$;
revoke all on function public.grocery_is_member(uuid) from public, anon;
grant execute on function public.grocery_is_member(uuid) to authenticated;

alter table public.grocery_profiles enable row level security;
alter table public.grocery_spaces enable row level security;
alter table public.grocery_memberships enable row level security;
alter table public.grocery_receipts enable row level security;
alter table public.grocery_list_items enable row level security;
alter table grocery_private.invitations enable row level security;
alter table grocery_private.photo_cleanup enable row level security;
-- Table writes must pass the validated RPC below. Read policies also protect
-- Realtime subscriptions; an unrelated household cannot subscribe to the data.
revoke all on public.grocery_profiles,public.grocery_spaces,public.grocery_memberships,public.grocery_receipts,public.grocery_list_items from anon,authenticated;
grant select on public.grocery_spaces,public.grocery_memberships,public.grocery_receipts,public.grocery_list_items to authenticated;
create policy spaces_read on public.grocery_spaces for select to authenticated using (public.grocery_is_member(id));
create policy memberships_read on public.grocery_memberships for select to authenticated using (public.grocery_is_member(space_id));
create policy receipts_read on public.grocery_receipts for select to authenticated using (public.grocery_is_member(space_id));
create policy list_read on public.grocery_list_items for select to authenticated using (public.grocery_is_member(space_id));

create function grocery_private.new_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid; dn text; hn text;
begin
  dn := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'displayName'),''),split_part(new.email,'@',1),'Grocery member'),60);
  hn := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'household'),''),'My household'),60);
  insert into public.grocery_profiles(id,email,display_name) values(new.id,coalesce(new.email,''),dn);
  insert into public.grocery_spaces(name,kind,owner_id) values('Personal','private',new.id) returning id into sid;
  insert into public.grocery_memberships values(sid,new.id,'owner',now());
  insert into public.grocery_spaces(name,kind,owner_id) values(hn,'household',new.id) returning id into sid;
  insert into public.grocery_memberships values(sid,new.id,'owner',now());
  return new;
end;
$$;
create trigger grocery_new_user after insert on auth.users for each row execute function grocery_private.new_user();

create function grocery_private.receipt_json(r public.grocery_receipts) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'spaceId',r.space_id,'merchant',r.merchant,'total',r.total,'purchaseDate',r.purchase_date,
 'purchaseTime',to_char(r.purchase_time,'HH24:MI'),'timezone',r.timezone,'purchaseInstant',r.purchase_instant,
 'photoUrl',case when r.photo_path is not null then '/api/receipts/'||r.id||'/photo' end,
 'photoPath',r.photo_path,'createdAt',r.created_at,'items',r.items);
$$;

create function grocery_private.save_receipt(sid uuid, body jsonb, rid uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.grocery_receipts; tz text; day date; clock time; item jsonb; normalized jsonb := '[]'; line numeric; qty numeric; amount numeric; unit text; unit_price numeric; unit_label text; pack numeric;
begin
 if not public.grocery_is_member(sid) then raise exception 'You are not a member of this workspace.' using errcode='42501'; end if;
 if rid is not null then select * into r from public.grocery_receipts where id=rid and space_id=sid for update; end if;
 select timezone into tz from public.grocery_spaces where id=sid;
 day := coalesce(body->>'purchaseDate',body->>'date',r.purchase_date::text)::date;
 clock := nullif(case when body ? 'purchaseTime' then body->>'purchaseTime' else r.purchase_time::text end,'')::time;
 tz := case when clock is not null then coalesce(body->>'timezone',r.timezone,tz) end;
 if day is null or day::text !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'A valid purchase date is required.'; end if;
 if tz is not null and not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Enter a valid timezone.'; end if;
 if body ? 'items' then
  if jsonb_typeof(body->'items') <> 'array' or jsonb_array_length(body->'items')>500 then raise exception 'Invalid receipt items.'; end if;
  for item in select value from jsonb_array_elements(body->'items') loop
   if length(btrim(coalesce(item->>'name','')))=0 then continue; end if;
   line := coalesce(item->>'linePrice',item->>'price','0')::numeric; qty := coalesce(item->>'quantity','1')::numeric;
   if line<0 or line>=100000000 or qty<=0 or qty>100000 then raise exception 'Invalid item price or quantity.'; end if;
   amount := nullif(item->>'measureAmount','')::numeric; unit := lower(item->>'measureUnit'); pack := nullif(item->>'packCount','')::numeric;
   unit_price := null; unit_label := null;
   if (item->>'name'||' '||coalesce(item->>'variant','')) ~* '\meggs?\M' and pack>1 then
    unit_price := line/(pack*qty); unit_label := 'egg';
   elsif amount>0 then
    if unit in ('g','kg','lb','oz') then unit_price := line/(qty*amount*case unit when 'g' then 1/453.59237 when 'kg' then 1000/453.59237 when 'oz' then 1.0/16 else 1 end); unit_label := 'lb';
    elsif unit in ('ml','l','fl oz','gal','qt','pt') then unit_price := line/(qty*amount*case unit when 'ml' then 0.001 when 'fl oz' then 0.0295735295625 when 'gal' then 3.785411784 when 'qt' then 0.946352946 when 'pt' then 0.473176473 else 1 end); unit_label := 'l'; end if;
   end if;
   normalized := normalized || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',left(btrim(item->>'name'),300),'variant',left(coalesce(item->>'variant',''),300),'category',left(coalesce(item->>'category','Other'),80),'linePrice',line,'quantity',qty,'packCount',pack,'measureAmount',amount,'measureUnit',unit,'unitPrice',unit_price,'unitPriceUnit',unit_label,'unitPriceAvailable',unit_price is not null));
  end loop;
 else normalized := coalesce(r.items,'[]'); end if;
 if body->>'photoPath' is not null and (split_part(body->>'photoPath','/',1)<>sid::text or body->>'photoPath' !~ '^[a-f0-9-]+/[a-f0-9-]+\.(jpg|png|webp)$') then raise exception 'Invalid photo path.'; end if;
 if rid is null then
  insert into public.grocery_receipts(space_id,merchant,total,purchase_date,purchase_time,timezone,purchase_instant,photo_path,items)
  values(sid,left(coalesce(body->>'merchant',body->>'store','Unknown store'),300),coalesce(body->>'total',body->>'amount')::numeric,day,clock,tz,case when clock is not null then (day+clock) at time zone tz end,body->>'photoPath',normalized) returning * into r;
 else
  update public.grocery_receipts set merchant=coalesce(body->>'merchant',r.merchant),total=coalesce((body->>'total')::numeric,r.total),purchase_date=day,purchase_time=clock,timezone=tz,purchase_instant=case when clock is not null then (day+clock) at time zone tz end,items=normalized,updated_at=now() where id=rid returning * into r;
 end if;
 update public.grocery_spaces set revision=revision+1 where id=sid;
 return grocery_private.receipt_json(r);
end;
$$;

create function public.grocery_api(method text, path text, query jsonb default '{}', payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); sid uuid; rid uuid; s public.grocery_spaces; r public.grocery_receipts; output jsonb; member uuid; entry jsonb; inv grocery_private.invitations; parts text[] := string_to_array(trim(both '/' from path),'/');
begin
 if uid is null then raise exception 'Sign in to access your household.' using errcode='42501'; end if;
 if not exists(select 1 from public.grocery_profiles where id=uid) then raise exception 'Account not found.' using errcode='42501'; end if;
 if octet_length(payload::text)>8000000 then raise exception 'This request is too large.'; end if;
 if path='/api/auth/me' then
  if method='PATCH' then
   if payload ? 'profileImage' and coalesce(payload->>'profileImage','')<>'' and payload->>'profileImage' !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$' then raise exception 'Choose a JPG, PNG or WebP profile photo.'; end if;
   update public.grocery_profiles set display_name=coalesce(nullif(btrim(payload->>'displayName'),''),display_name),profile_image=coalesce(payload->>'profileImage',profile_image) where id=uid;
  elsif method='DELETE' then
   if payload->>'confirmation' is distinct from 'DELETE ACCOUNT' then raise exception 'Type DELETE ACCOUNT to confirm.'; end if;
   for s in select * from public.grocery_spaces where owner_id=uid for update loop
    select user_id into member from public.grocery_memberships where space_id=s.id and user_id<>uid order by created_at,user_id limit 1;
    if s.kind='household' and member is not null then
     update public.grocery_spaces set owner_id=member,revision=revision+1 where id=s.id;
     update public.grocery_memberships set role='owner' where space_id=s.id and user_id=member;
    else
     insert into grocery_private.photo_cleanup(path,user_id) select photo_path,uid from public.grocery_receipts where space_id=s.id and photo_path is not null on conflict do nothing;
     delete from public.grocery_spaces where id=s.id;
    end if;
   end loop;
   delete from auth.users where id=uid;
   return null;
  elsif method<>'GET' then raise exception 'Unsupported account operation.'; end if;
  return (select jsonb_build_object('id',id,'email',email,'displayName',display_name,'profileImage',profile_image) from public.grocery_profiles where id=uid);
 end if;
 if path='/api/spaces' then
  if method='POST' then
   insert into public.grocery_spaces(name,kind,owner_id) values(btrim(payload->>'name'),payload->>'kind',uid) returning * into s;
   insert into public.grocery_memberships(space_id,user_id,role) values(s.id,uid,'owner');
   return jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind,'timezone',s.timezone,'role','owner');
  elsif method<>'GET' then raise exception 'Unsupported workspace operation.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'timezone',a.timezone,'role',m.role) order by a.kind desc,a.name) from public.grocery_spaces a join public.grocery_memberships m on m.space_id=a.id where m.user_id=uid),'[]');
 end if;
 if parts[2]='invitations' and parts[4]='accept' and method='POST' then
  select * into inv from grocery_private.invitations where token=parts[3] and expires_at>now();
  if inv.space_id is null then raise exception 'Invitation has expired or is invalid.'; end if;
  insert into public.grocery_memberships(space_id,user_id,role) values(inv.space_id,uid,'member') on conflict do nothing;
  update public.grocery_spaces set revision=revision+1 where id=inv.space_id;
  -- Put the invited workspace first so both clients select the correct household.
  return (select jsonb_agg(value order by (value->>'id'=inv.space_id::text) desc) from jsonb_array_elements(public.grocery_api('GET','/api/spaces')));
 end if;
 if parts[2]='spaces' then
  sid := parts[3]::uuid;
  select * into s from public.grocery_spaces where id=sid;
  if not public.grocery_is_member(sid) then raise exception 'Workspace access denied.' using errcode='42501'; end if;
  if parts[4]='members' and method='GET' then
   select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'email',p.email,'displayName',p.display_name,'profileImage',p.profile_image,'role',m.role) order by m.role desc,p.display_name),'[]') into output from public.grocery_memberships m join public.grocery_profiles p on p.id=m.user_id where m.space_id=sid;
   return jsonb_build_object('space',jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind),'count',jsonb_array_length(output),'members',output);
  end if;
  if parts[4]='settings' then
   if method='PATCH' then
    if payload ? 'budget' and payload->'budget'<>'null'::jsonb and ((payload->>'budget')::numeric<0 or (payload->>'budget')::numeric>100000000) then raise exception 'Invalid budget.'; end if;
    if payload ? 'goal' and payload->'goal'<>'null'::jsonb and (length(payload->'goal'->>'name')>300 or coalesce((payload->'goal'->>'amount')::numeric,-1)<0) then raise exception 'Invalid goal.'; end if;
    update public.grocery_spaces set settings=settings || (payload - array(select key from jsonb_object_keys(payload) key where key not in ('budget','goal'))),revision=revision+1 where id=sid returning * into s;
   elsif method<>'GET' then raise exception 'Unsupported settings operation.'; end if;
   return s.settings;
  end if;
  if parts[4]='list' then
   if method='POST' then insert into public.grocery_list_items(space_id,name) values(sid,btrim(payload->>'name'));
   elsif method='DELETE' then delete from public.grocery_list_items where id=(payload->>'id')::uuid and space_id=sid;
   elsif method<>'GET' then raise exception 'Unsupported list operation.'; end if;
   if method<>'GET' then update public.grocery_spaces set revision=revision+1 where id=sid; end if;
   return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by created_at,id) from public.grocery_list_items where space_id=sid),'[]');
  end if;
  if s.owner_id<>uid then raise exception 'Only the workspace owner can do this.' using errcode='42501'; end if;
  if parts[4]='invitations' and method='POST' then
   if s.kind<>'household' then raise exception 'Only households can invite members.'; end if;
   insert into grocery_private.invitations(space_id) values(sid) returning * into inv;
   return jsonb_build_object('token',inv.token,'expiresAt',inv.expires_at);
  elsif array_length(parts,1)=3 and method='PATCH' then
   if payload ? 'timezone' and not exists(select 1 from pg_timezone_names where name=payload->>'timezone') then raise exception 'Invalid timezone.'; end if;
   update public.grocery_spaces set name=coalesce(payload->>'name',name),timezone=coalesce(payload->>'timezone',timezone),revision=revision+1 where id=sid returning * into s;
   return jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind,'timezone',s.timezone,'role','owner');
  elsif array_length(parts,1)=3 and method='DELETE' then
   if payload->>'confirmation' is distinct from s.name then raise exception 'Type the workspace name to confirm.'; end if;
   if (select count(*) from public.grocery_memberships where user_id=uid)<=1 then raise exception 'Create another workspace before deleting your last one.'; end if;
   insert into grocery_private.photo_cleanup(path,user_id) select photo_path,uid from public.grocery_receipts where space_id=sid and photo_path is not null on conflict do nothing;
   delete from public.grocery_spaces where id=sid;
   return null;
  end if;
 end if;
 if parts[2]='receipts' then
  if array_length(parts,1)=2 then
   sid := coalesce(query->>'spaceId',payload->>'spaceId')::uuid;
   if not public.grocery_is_member(sid) then raise exception 'Workspace access denied.' using errcode='42501'; end if;
   if method='GET' then return coalesce((select jsonb_agg(grocery_private.receipt_json(a) order by purchase_date desc,purchase_time desc nulls last,created_at desc) from public.grocery_receipts a where space_id=sid),'[]');
   elsif method='POST' then return grocery_private.save_receipt(sid,payload); end if;
  else
   select * into r from public.grocery_receipts where id=parts[3]::uuid;
   if r.id is null or not public.grocery_is_member(r.space_id) then raise exception 'Receipt not found in a workspace you can access.' using errcode='42501'; end if;
   if method='GET' and (array_length(parts,1)=3 or parts[4]='photo') then return grocery_private.receipt_json(r);
   elsif method='PATCH' and array_length(parts,1)=3 then return grocery_private.save_receipt(r.space_id,payload,r.id);
   elsif method='DELETE' and array_length(parts,1)=3 then
    if r.photo_path is not null then insert into grocery_private.photo_cleanup(path,user_id) values(r.photo_path,uid) on conflict do nothing; end if;
    delete from public.grocery_receipts where id=r.id;
    update public.grocery_spaces set revision=revision+1 where id=r.space_id;
    return null;
   end if;
  end if;
 end if;
 if path in ('/api/backup','/api/backup/restore') then
  sid := coalesce(query->>'spaceId',payload->>'spaceId')::uuid;
  select * into s from public.grocery_spaces where id=sid and owner_id=uid for update;
  if s.id is null then raise exception 'Only the workspace owner can manage backups.' using errcode='42501'; end if;
  if method='GET' and path='/api/backup' then
   return jsonb_build_object('format','groceries-tracker-backup-v1','space',to_jsonb(s),'receipts',public.grocery_api('GET','/api/receipts',jsonb_build_object('spaceId',sid)),'settings',s.settings,'groceryList',public.grocery_api('GET','/api/spaces/'||sid||'/list'));
  elsif method='POST' and path='/api/backup/restore' then
   if payload->>'format' is distinct from 'groceries-tracker-backup-v1' or jsonb_typeof(payload->'receipts') is distinct from 'array' then raise exception 'Unsupported backup file.'; end if;
   for entry in select value from jsonb_array_elements(payload->'receipts') loop perform grocery_private.save_receipt(sid,entry); end loop;
   if payload ? 'settings' then perform public.grocery_api('PATCH','/api/spaces/'||sid||'/settings','{}',payload->'settings'); end if;
   for entry in select value from jsonb_array_elements(coalesce(payload->'groceryList','[]')) loop perform public.grocery_api('POST','/api/spaces/'||sid||'/list','{}',entry); end loop;
   return jsonb_build_object('restored',jsonb_array_length(payload->'receipts'));
  end if;
 end if;
 raise exception 'Unsupported API operation.';
end;
$$;
revoke all on function public.grocery_api(text,text,jsonb,jsonb) from public,anon;
grant execute on function public.grocery_api(text,text,jsonb,jsonb) to authenticated;
revoke all on all functions in schema grocery_private from public,anon,authenticated;

-- Private photos: uploads and downloads require active household membership.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('grocery-photos','grocery-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create function public.grocery_photo_allowed(object_name text, deleting boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then return false; end if;
 if deleting and exists(select 1 from grocery_private.photo_cleanup where path=object_name and user_id=auth.uid()) then return true; end if;
 if object_name !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$' then return false; end if;
 return public.grocery_is_member(split_part(object_name,'/',1)::uuid);
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.grocery_photo_allowed(text,boolean) from public,anon;
grant execute on function public.grocery_photo_allowed(text,boolean) to authenticated;
create policy grocery_photos_read on storage.objects for select to authenticated using(bucket_id='grocery-photos' and public.grocery_photo_allowed(name));
create policy grocery_photos_insert on storage.objects for insert to authenticated with check(bucket_id='grocery-photos' and public.grocery_photo_allowed(name));
create policy grocery_photos_delete on storage.objects for delete to authenticated using(bucket_id='grocery-photos' and public.grocery_photo_allowed(name,true));
create function public.grocery_cleanup(done text[] default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 delete from grocery_private.photo_cleanup where user_id=auth.uid() and path=any(done);
 return coalesce((select jsonb_agg(path) from grocery_private.photo_cleanup where user_id=auth.uid()),'[]');
end;
$$;
revoke all on function public.grocery_cleanup(text[]) from public,anon;
grant execute on function public.grocery_cleanup(text[]) to authenticated;

-- One small revision event invalidates each active client's cached workspace.
alter publication supabase_realtime add table public.grocery_spaces;
