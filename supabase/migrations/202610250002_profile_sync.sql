-- Profile changes notify every household containing this member.
create function grocery_private.profile_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.grocery_spaces set revision=revision+1 where id in
 (select space_id from public.grocery_memberships where user_id=new.id);
 return new;
end;
$$;
revoke all on function grocery_private.profile_changed() from public,anon,authenticated;
create trigger grocery_profile_changed after update on public.grocery_profiles
for each row execute function grocery_private.profile_changed();
