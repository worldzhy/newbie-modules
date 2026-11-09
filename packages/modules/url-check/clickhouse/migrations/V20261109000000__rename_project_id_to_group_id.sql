-- UrlCheckTarget ownership moved from the host Project to the host grouping
-- entity (groupId); the denormalized owner column follows the new name.
ALTER TABLE url_check_results RENAME COLUMN project_id TO group_id;
