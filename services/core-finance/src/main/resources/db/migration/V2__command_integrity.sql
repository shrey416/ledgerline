ALTER TABLE command_result ADD CONSTRAINT command_posting_result FOREIGN KEY(workspace_id,result_id) REFERENCES journal_transaction(workspace_id,id) DEFERRABLE INITIALLY DEFERRED;
