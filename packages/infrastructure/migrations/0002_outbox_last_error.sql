-- Why a webhook delivery last failed. Before this column a failed attempt kept only its count and next
-- retry time, so an operator could see that an endpoint was failing but never what the receiver answered.
-- The text is the channel's own short reason (an HTTP status or a network error), never the payload.

-- Up Migration

alter table outbox add column if not exists last_error text;

-- Down Migration

alter table outbox drop column if exists last_error;
