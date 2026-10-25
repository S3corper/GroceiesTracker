-- Storage DELETE first selects the objects. Keep deleted-space photos visible only
-- to the authenticated requester while their durable cleanup entry exists.
alter policy grocery_photos_read on storage.objects
using (bucket_id='grocery-photos' and public.grocery_photo_allowed(name,true));

create or replace function public.grocery_cleanup(done text[] default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 delete from grocery_private.photo_cleanup q
 where q.user_id=auth.uid() and q.path=any(done)
 and not exists(select 1 from storage.objects o where o.bucket_id='grocery-photos' and o.name=q.path);
 return coalesce((select jsonb_agg(path) from grocery_private.photo_cleanup where user_id=auth.uid()),'[]');
end;
$$;
