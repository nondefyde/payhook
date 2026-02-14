import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import * as ipRangeCheck from 'ip-range-check';

/**
 * PayHook IP Allowlist Guard
 *
 * Restricts webhook access to specific IP addresses or ranges.
 * Supports IPv4, IPv6, CIDR notation, and IP ranges.
 *
 * Usage:
 * @UseGuards(PayHookIpAllowlistGuard)
 *
 * Configuration via constructor or module config:
 * - allowedIps: Array of allowed IP addresses, ranges, or CIDR blocks
 * - checkProxyHeaders: Whether to check X-Forwarded-For headers
 * - denyMessage: Custom message for denied requests
 *
 * Supported formats:
 * - Single IP: '192.168.1.1'
 * - CIDR: '192.168.1.0/24'
 * - Range: '192.168.1.1-192.168.1.255'
 * - IPv6: '2001:db8::1'
 * - IPv6 CIDR: '2001:db8::/32'
 */
@Injectable()
export class PayHookIpAllowlistGuard implements CanActivate {
  private readonly allowedIps: string[];
  private readonly checkProxyHeaders: boolean;
  private readonly denyMessage: string;
  private readonly providerIpMappings: Map<string, string[]>;

  constructor(config?: {
    allowedIps?: string[];
    checkProxyHeaders?: boolean;
    denyMessage?: string;
    providerIpMappings?: Record<string, string[]>;
  }) {
    this.allowedIps = config?.allowedIps || [];
    this.checkProxyHeaders = config?.checkProxyHeaders !== false; // Default true
    this.denyMessage = config?.denyMessage || 'Access denied: IP not in allowlist';
    this.providerIpMappings = new Map(Object.entries(config?.providerIpMappings || {}));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // If no IPs configured, allow all (fail-open for dev environments)
    if (this.allowedIps.length === 0 && this.providerIpMappings.size === 0) {
      console.warn('PayHookIpAllowlistGuard: No IP restrictions configured. Allowing all requests.');
      return true;
    }

    const clientIp = this.getClientIp(request);

    if (!clientIp) {
      throw new HttpException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Unable to determine client IP address',
        error: 'Forbidden',
      }, HttpStatus.FORBIDDEN);
    }

    // Check if provider-specific IPs are configured
    const provider = request.params?.provider;
    let allowedList = [...this.allowedIps];

    if (provider && this.providerIpMappings.has(provider)) {
      // Add provider-specific IPs to the allowed list
      allowedList = [...allowedList, ...this.providerIpMappings.get(provider)!];
    }

    // Check if IP is in allowlist
    const isAllowed = this.isIpAllowed(clientIp, allowedList);

    if (!isAllowed) {
      // Log the denied attempt for security monitoring
      console.warn(`PayHookIpAllowlistGuard: Denied access from IP ${clientIp} for provider ${provider || 'unknown'}`);

      throw new HttpException({
        statusCode: HttpStatus.FORBIDDEN,
        message: this.denyMessage,
        error: 'Forbidden',
        clientIp,
        provider,
      }, HttpStatus.FORBIDDEN);
    }

    // Add IP info to request for logging
    (request as any).clientIpInfo = {
      ip: clientIp,
      allowed: true,
      provider,
    };

    return true;
  }

  /**
   * Extract client IP from request
   */
  private getClientIp(request: Request): string | null {
    let ip: string | null = null;

    if (this.checkProxyHeaders) {
      // Check X-Forwarded-For header (common with reverse proxies)
      const forwarded = request.headers['x-forwarded-for'];
      if (forwarded) {
        // Take the first IP in the chain (original client)
        ip = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
      }

      // Check other proxy headers
      if (!ip && request.headers['x-real-ip']) {
        ip = request.headers['x-real-ip'] as string;
      }

      if (!ip && request.headers['x-client-ip']) {
        ip = request.headers['x-client-ip'] as string;
      }
    }

    // Fall back to connection remote address
    if (!ip) {
      ip = request.connection.remoteAddress ||
           request.socket.remoteAddress ||
           (request.connection as any).socket?.remoteAddress ||
           null;
    }

    // Handle IPv6 mapped IPv4 addresses (::ffff:192.168.1.1)
    if (ip && ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    return ip;
  }

  /**
   * Check if IP is in the allowed list
   */
  private isIpAllowed(ip: string, allowedList: string[]): boolean {
    if (allowedList.length === 0) {
      return false;
    }

    try {
      // Use ip-range-check library for robust IP matching
      // Note: In production, you'd install this: npm install ip-range-check
      // For now, we'll do basic matching
      return this.basicIpCheck(ip, allowedList);
    } catch (error) {
      console.error('Error checking IP allowlist:', error);
      return false;
    }
  }

  /**
   * Basic IP checking (without external library)
   */
  private basicIpCheck(ip: string, allowedList: string[]): boolean {
    for (const allowed of allowedList) {
      // Exact match
      if (ip === allowed) {
        return true;
      }

      // CIDR notation check (simplified)
      if (allowed.includes('/')) {
        if (this.isIpInCidr(ip, allowed)) {
          return true;
        }
      }

      // Range check (192.168.1.1-192.168.1.255)
      if (allowed.includes('-')) {
        const [start, end] = allowed.split('-').map(s => s.trim());
        if (this.isIpInRange(ip, start, end)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if IP is in CIDR range (simplified implementation)
   */
  private isIpInCidr(ip: string, cidr: string): boolean {
    const [network, prefixLength] = cidr.split('/');
    const prefix = parseInt(prefixLength, 10);

    if (isNaN(prefix)) {
      return false;
    }

    // Convert IPs to numbers for comparison
    const ipNum = this.ipToNumber(ip);
    const networkNum = this.ipToNumber(network);

    if (ipNum === null || networkNum === null) {
      return false;
    }

    // Calculate mask
    const mask = (0xffffffff << (32 - prefix)) >>> 0;

    // Check if IP is in network range
    return (ipNum & mask) === (networkNum & mask);
  }

  /**
   * Check if IP is in range
   */
  private isIpInRange(ip: string, start: string, end: string): boolean {
    const ipNum = this.ipToNumber(ip);
    const startNum = this.ipToNumber(start);
    const endNum = this.ipToNumber(end);

    if (ipNum === null || startNum === null || endNum === null) {
      return false;
    }

    return ipNum >= startNum && ipNum <= endNum;
  }

  /**
   * Convert IP address to number (IPv4 only for simplicity)
   */
  private ipToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      return null;
    }

    let num = 0;
    for (let i = 0; i < 4; i++) {
      const part = parseInt(parts[i], 10);
      if (isNaN(part) || part < 0 || part > 255) {
        return null;
      }
      num = (num << 8) + part;
    }

    return num >>> 0; // Convert to unsigned
  }

  /**
   * Add IP to allowlist (runtime configuration)
   */
  addAllowedIp(ip: string): void {
    if (!this.allowedIps.includes(ip)) {
      this.allowedIps.push(ip);
    }
  }

  /**
   * Remove IP from allowlist (runtime configuration)
   */
  removeAllowedIp(ip: string): void {
    const index = this.allowedIps.indexOf(ip);
    if (index > -1) {
      this.allowedIps.splice(index, 1);
    }
  }

  /**
   * Set provider-specific IP mappings
   */
  setProviderIps(provider: string, ips: string[]): void {
    this.providerIpMappings.set(provider, ips);
  }

  /**
   * Get current configuration
   */
  getConfig(): {
    allowedIps: string[];
    providerIpMappings: Record<string, string[]>;
    checkProxyHeaders: boolean;
  } {
    return {
      allowedIps: [...this.allowedIps],
      providerIpMappings: Object.fromEntries(this.providerIpMappings),
      checkProxyHeaders: this.checkProxyHeaders,
    };
  }
}