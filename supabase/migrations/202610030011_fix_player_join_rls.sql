begin;

-- Stop direct player inserts
drop policy if exists player_inserts_self on public.game_players;
revoke insert on public.game_players from authenticated;

-- Secure join RPC
create or replace function public.join_game_player(
  p_game_code text,
  p_nickname text,
  p_avatar text
)
returns table (
  player_id uuid,
  game_id uuid,
  game_code text,
  game_name text,
  nickname text,
  avatar text,
  balance numeric,
  score integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_player public.game_players%rowtype;
  v_nickname text := trim(p_nickname);
  v_code text := upper(trim(p_game_code));
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if char_length(v_nickname) < 2 or char_length(v_nickname) > 20 then
    raise exception 'Nickname must be 2-20 characters.';
  end if;

  if p_avatar not in (
    'straw-hat',
    'swordsman',
    'navigator',
    'cook',
    'doctor',
    'captain',
    'pirate-flag',
    'sniper',
    'shipwright',
    'musician'
  ) then
    raise exception 'Invalid avatar.';
  end if;

  select *
  into v_game
  from public.games
  where upper(game_code) = v_code
  limit 1;

  if not found then
    raise exception 'Game not found.';
  end if;

  -- Rejoin existing player
  select *
  into v_player
  from public.game_players
  where game_players.game_id = v_game.id
    and user_id = v_user_id
  limit 1;

  if found then
    return query
    select
      v_player.id,
      v_game.id,
      v_game.game_code,
      v_game.name,
      v_player.nickname,
      v_player.avatar,
      v_player.balance,
      v_player.score,
      v_game.status;

    return;
  end if;

  -- New players only while waiting
  if v_game.status <> 'waiting' then
    raise exception 'This game has already started or ended.';
  end if;

  insert into public.game_players (
    game_id,
    user_id,
    nickname,
    avatar,
    balance,
    score
  )
  values (
    v_game.id,
    v_user_id,
    v_nickname,
    p_avatar,
    v_game.starting_balance,
    0
  )
  returning * into v_player;

  return query
  select
    v_player.id,
    v_game.id,
    v_game.game_code,
    v_game.name,
    v_player.nickname,
    v_player.avatar,
    v_player.balance,
    v_player.score,
    v_game.status;
end;
$$;

revoke all on function public.join_game_player(text, text, text) from public;
grant execute on function public.join_game_player(text, text, text) to authenticated;

commit;