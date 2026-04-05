# QBO API Department Filter

From the official QBO API docs:

> **department** (Optional, String): Filters report contents to include information for specified departments if so configured in the company file. Supported Values: One or more comma separated **department IDs** as returned in the attribute, `Department.Id` of the Department object response code.

So the `department` parameter expects the **numeric Department.Id**, NOT the name "PK" or "MK".

The fix: Store the Department ID (not name) in the entity's departmentFilter field, or query QBO for the department ID at report fetch time.
