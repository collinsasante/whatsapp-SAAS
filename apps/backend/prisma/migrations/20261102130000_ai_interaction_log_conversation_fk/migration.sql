-- AiInteractionLog.conversation_id becomes a real foreign key (ON DELETE CASCADE), added NOT VALID.
--
-- Why: deleting a conversation must also delete the AI interaction logs that quote its customer messages, and a log must not be
-- created for a conversation that is being deleted. With the key in place the database enforces both: an INSERT takes a share lock on
-- the conversation row, which waits for a deleter's exclusive lock and then fails with 23503, and a delete cascades to committed logs.
--
-- NOT VALID: the constraint is enforced for every new or changed row but is NOT checked against rows that already exist, so this
-- migration cannot fail on, or take a long lock scanning, historical orphans (logs whose conversation is already gone). Cleaning those
-- up, and then running ALTER TABLE ... VALIDATE CONSTRAINT, are separate operator-approved steps that this migration does not perform.
ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
