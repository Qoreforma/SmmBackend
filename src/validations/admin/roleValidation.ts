import { ALL_PERMISSIONS } from "@/utils/admin-permissions";
import Joi from "joi";

export const roleNameSchema = Joi.string()
  .min(3)
  .max(50)
  .pattern(/^[a-zA-Z0-9_-\s]+$/)
  .messages({
    "string.empty": "Role name cannot be empty",
    "string.min": "Role name must be at least 3 characters long",
    "string.max": "Role name cannot exceed 50 characters",
    "string.pattern.base":
      "Role name can only contain letters, numbers, spaces, hyphens, and underscores",
  });

export const roleDescriptionSchema = Joi.string().min(10).max(500).messages({
  "string.empty": "Role description cannot be empty",
  "string.min": "Role description must be at least 10 characters long",
  "string.max": "Role description cannot exceed 500 characters",
});

export const mongoIdSchema = Joi.string().hex().length(24).messages({
  "string.hex": "Invalid ID format",
  "string.length": "Invalid ID length",
});

export const roleIdParams = Joi.object({
  id: mongoIdSchema.required().messages({
    "any.required": "Role ID is required",
  }),
});

export const paginationQuery = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1).messages({
    "number.base": "Page must be a number",
    "number.integer": "Page must be an integer",
    "number.min": "Page must be at least 1",
  }),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .messages({
      "number.base": "Limit must be a number",
      "number.integer": "Limit must be an integer",
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
    }),
});

export const getRolesQuery = paginationQuery.keys({
  search: Joi.string().min(1).max(100).optional().messages({
    "string.empty": "Search term cannot be empty",
    "string.min": "Search term must be at least 1 character",
    "string.max": "Search term cannot exceed 100 characters",
  }),

  sortBy: Joi.string()
    .valid("name", "createdAt", "updatedAt", "description")
    .optional()
    .default("createdAt")
    .messages({
      "any.only":
        "sortBy must be one of: name, createdAt, updatedAt, description",
    }),
  sortOrder: Joi.string()
    .valid("asc", "desc")
    .optional()
    .default("desc")
    .messages({
      "any.only": "sortOrder must be 'asc' or 'desc'",
    }),
});

// Filters out stale/unknown permission strings instead of throwing.
// Used anywhere an EXISTING role's permissions might be re-submitted
// (update, patch permissions, bulk update) — since seeded/legacy roles
// can carry permission keys that no longer exist in ALL_PERMISSIONS.
const permissionsFilterSchema = (required = false) => {
  const schema = Joi.array()
    .items(Joi.string())
    .custom((value: string[], helpers) => {
      const filtered = value.filter((p) =>
        (ALL_PERMISSIONS as readonly string[]).includes(p),
      );
      if (filtered.length === 0) {
        return helpers.error("array.min");
      }
      return filtered;
    })
    .messages({
      "array.min": "At least one valid permission must be selected",
    });

  return required ? schema.required() : schema.optional();
};

export const createRoleSchema = Joi.object({
  name: roleNameSchema.required().messages({
    "any.required": "Role name is required",
  }),
  description: roleDescriptionSchema.required().messages({
    "any.required": "Role description is required",
  }),
  permissions: Joi.array()
    .items(Joi.string().valid(...ALL_PERMISSIONS))
    .min(1)
    .required()
    .messages({
      "any.required": "At least one permission is required",
      "array.min": "At least one permission must be selected",
      "any.only": "Invalid permission selected",
    }),
});

export const updateRoleBody = Joi.object({
  name: roleNameSchema.optional(),
  description: roleDescriptionSchema.optional(),
  permissions: permissionsFilterSchema(false),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

export const assignRoleBody = Joi.object({
  adminId: mongoIdSchema.required().messages({
    "any.required": "Admin ID is required",
  }),
  roleId: mongoIdSchema.required().messages({
    "any.required": "Role ID is required",
  }),
});

export const rolePermissionsBody = Joi.object({
  permissions: permissionsFilterSchema(true),
});

export const bulkUpdateRolesBody = Joi.object({
  updates: Joi.array()
    .items(
      Joi.object({
        id: mongoIdSchema.required().messages({
          "any.required": "Role ID is required",
        }),
        data: Joi.object({
          name: roleNameSchema.optional(),
          description: roleDescriptionSchema.optional(),
          permissions: permissionsFilterSchema(false),
        }).min(1),
      }),
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      "any.required": "Updates array is required",
      "array.min": "At least one update is required",
      "array.max": "Cannot exceed 50 updates at once",
    }),
});

export const bulkDeleteRolesBody = Joi.object({
  ids: Joi.array().items(mongoIdSchema).min(1).max(50).required().messages({
    "any.required": "Role IDs array is required",
    "array.min": "At least one role ID is required",
    "array.max": "Cannot delete more than 50 roles at once",
  }),
});

export const updateRoleSchema = {
  params: roleIdParams,
  body: updateRoleBody,
};

export const getRolesSchema = {
  query: getRolesQuery,
};

export const getRoleByIdSchema = {
  params: roleIdParams,
};

export const deleteRoleSchema = {
  params: roleIdParams,
};

export const assignRoleSchema = {
  body: assignRoleBody,
};

export const updateRolePermissionsSchema = {
  params: roleIdParams,
  body: rolePermissionsBody,
};

export const getUsersByRoleSchema = {
  params: roleIdParams,
  query: paginationQuery,
};

export const bulkUpdateRolesSchema = {
  body: bulkUpdateRolesBody,
};

export const bulkDeleteRolesSchema = {
  body: bulkDeleteRolesBody,
};

export const validateUniquePermissionIds = (permissions: any[]) => {
  const ids = permissions.map((p) => p.id);
  const uniqueIds = new Set(ids);

  if (ids.length !== uniqueIds.size) {
    throw new Error("Permission IDs must be unique within a role");
  }
  return true;
};

export const validatePermissionCombination = (permissions: any[]) => {
  const resourceActions = new Map();

  for (const permission of permissions) {
    const key = `${permission.resource}_${permission.action}`;
    if (resourceActions.has(key)) {
      throw new Error(
        `Duplicate permission found: ${permission.resource}.${permission.action}`,
      );
    }
    resourceActions.set(key, true);
  }

  return true;
};
