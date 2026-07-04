insert into public.app_admins (email)
values ('sherwoodwallet@gmail.com')
on conflict (email) do nothing;
