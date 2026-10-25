create index grocery_invitations_space_idx on grocery_private.invitations(space_id);
create index grocery_list_space_idx on public.grocery_list_items(space_id,created_at);
create index grocery_spaces_owner_idx on public.grocery_spaces(owner_id);
create index grocery_cleanup_user_idx on grocery_private.photo_cleanup(user_id);
