import { ResultAsync } from 'neverthrow';

import { CreateUserData, User, UserStatus } from '../aggregates/user/user.aggregate';
import { DomainError } from '../errors/domain-errors';

/**
 * User Repository Interface
 *
 * Defines the contract for persisting and retrieving User aggregates.
 * User is the primary aggregate root for multi-tenant operations.
 *
 * Following Domain-Driven Design principles:
 * - Repository pattern for aggregate persistence
 * - Dependency inversion - core defines interface, infrastructure implements
 * - All operations return ResultAsync for explicit error handling
 * - User management for multi-tenant architecture
 */
export interface IUserRepository {
  /**
   * Count total users
   * Used for reporting and pagination
   *
   * @returns ResultAsync<number, DomainError> - Total count of users
   */
  count(): ResultAsync<number, DomainError>;

  /**
   * Count users by status
   * Used for administrative reporting
   *
   * @param status - User status to count
   * @returns ResultAsync<number, DomainError> - Count of users with given status
   */
  countByStatus(status: UserStatus): ResultAsync<number, DomainError>;

  /**
   * Create a new user
   * Must enforce uniqueness constraints on user ID and email
   *
   * @param userData - User creation data
   * @returns ResultAsync<User, DomainError> - Created user or domain error
   */
  create(userData: CreateUserData): ResultAsync<User, DomainError>;

  /**
   * Delete a user by ID
   * Should validate no dependent data exists (accounts, transactions)
   *
   * @param userId - Unique user identifier to delete
   * @returns ResultAsync<boolean, DomainError> - True if deleted, false if not found
   */
  delete(userId: string): ResultAsync<boolean, DomainError>;

  /**
   * Check if user exists by email
   * Used during registration to prevent duplicate emails
   *
   * @param email - Email address to check
   * @returns ResultAsync<boolean, DomainError> - True if exists, false otherwise
   */
  existsByEmail(email: string): ResultAsync<boolean, DomainError>;

  /**
   * Check if user exists by ID
   * Used for validation without full retrieval
   *
   * @param userId - User ID to check
   * @returns ResultAsync<boolean, DomainError> - True if exists, false otherwise
   */
  existsById(userId: string): ResultAsync<boolean, DomainError>;

  /**
   * Find all users (paginated)
   * Used for administrative user listing
   *
   * @param limit - Maximum number of results to return
   * @param offset - Number of results to skip for pagination
   * @returns ResultAsync<User[], DomainError> - List of users
   */
  findAll(limit?: number, offset?: number): ResultAsync<User[], DomainError>;

  /**
   * Find user by email address
   * Used for authentication and user lookup during login
   *
   * @param email - User's email address
   * @returns ResultAsync<User | null, DomainError> - User or null if not found
   */
  findByEmail(email: string): ResultAsync<User | null, DomainError>;

  /**
   * Find user by their unique ID
   * Primary lookup method for user authentication and operations
   *
   * @param userId - Unique user identifier (UUID)
   * @returns ResultAsync<User | null, DomainError> - User or null if not found
   */
  findById(userId: string): ResultAsync<User | null, DomainError>;

  /**
   * Find users by status
   * Used for administrative operations and user management
   *
   * @param status - User status filter
   * @param limit - Maximum number of results to return
   * @param offset - Number of results to skip for pagination
   * @returns ResultAsync<User[], DomainError> - List of matching users
   */
  findByStatus(status: UserStatus, limit?: number, offset?: number): ResultAsync<User[], DomainError>;

  /**
   * Find or create user
   * Atomic operation for user registration/authentication flows
   *
   * @param userData - User creation data (used if user doesn't exist)
   * @returns ResultAsync<User, DomainError> - Existing or newly created user
   */
  findOrCreate(userData: CreateUserData): ResultAsync<User, DomainError>;

  /**
   * Update an existing user
   * Core user identifiers (ID, email) may have constraints
   *
   * @param user - User aggregate to update
   * @returns ResultAsync<User, DomainError> - Updated user or domain error
   */
  update(user: User): ResultAsync<User, DomainError>;

  /**
   * Update user status
   * Optimized operation for status changes (activate/deactivate/suspend)
   *
   * @param userId - User ID to update
   * @param status - New status to set
   * @returns ResultAsync<User, DomainError> - Updated user or domain error
   */
  updateStatus(userId: string, status: UserStatus): ResultAsync<User, DomainError>;
}
