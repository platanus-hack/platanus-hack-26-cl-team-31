SELECT asker.person_id AS requester, owner.person_id AS recipient, asker.group_id
FROM memberships asker
JOIN memberships owner ON owner.group_id = asker.group_id
WHERE asker.can_ask AND owner.can_share
