ALTER TABLE batch_genealogy DROP CONSTRAINT IF EXISTS batch_genealogy_relationship_type_check;
ALTER TABLE batch_genealogy ADD CONSTRAINT batch_genealogy_relationship_type_check
  CHECK(relationship_type IN ('PROCESS','SORT','GRADE_SPLIT','MERGE','TRANSFER','DELIVERY_AGGREGATE'));
