/**
 * Money value object - immutable representation of monetary values
 * Stores amounts in smallest currency unit (e.g., cents, kobo)
 */
export class Money {
  private readonly _amount: number;
  private readonly _currency: string;

  constructor(amount: number, currency: string) {
    if (!Number.isInteger(amount)) {
      throw new Error('Amount must be an integer (smallest currency unit)');
    }
    if (amount < 0) {
      throw new Error('Amount cannot be negative');
    }
    if (!currency || currency.length !== 3) {
      throw new Error('Currency must be a 3-letter ISO 4217 code');
    }

    this._amount = amount;
    this._currency = currency.toUpperCase();
  }

  get amount(): number {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  /**
   * Check if two Money objects are equal
   */
  equals(other: Money): boolean {
    return this._amount === other._amount && this._currency === other._currency;
  }

  /**
   * Add two Money objects (must be same currency)
   */
  add(other: Money): Money {
    if (this._currency !== other._currency) {
      throw new Error(
        `Cannot add different currencies: ${this._currency} and ${other._currency}`,
      );
    }
    return new Money(this._amount + other._amount, this._currency);
  }

  /**
   * Subtract another Money object (must be same currency)
   */
  subtract(other: Money): Money {
    if (this._currency !== other._currency) {
      throw new Error(
        `Cannot subtract different currencies: ${this._currency} and ${other._currency}`,
      );
    }
    if (this._amount < other._amount) {
      throw new Error('Subtraction would result in negative amount');
    }
    return new Money(this._amount - other._amount, this._currency);
  }

  /**
   * Check if this amount is greater than another
   */
  isGreaterThan(other: Money): boolean {
    if (this._currency !== other._currency) {
      throw new Error(
        `Cannot compare different currencies: ${this._currency} and ${other._currency}`,
      );
    }
    return this._amount > other._amount;
  }

  /**
   * Check if this amount is less than another
   */
  isLessThan(other: Money): boolean {
    if (this._currency !== other._currency) {
      throw new Error(
        `Cannot compare different currencies: ${this._currency} and ${other._currency}`,
      );
    }
    return this._amount < other._amount;
  }

  /**
   * Check if amount is zero
   */
  isZero(): boolean {
    return this._amount === 0;
  }

  /**
   * Convert to major currency units (e.g., dollars from cents)
   * Assumes 2 decimal places for most currencies
   */
  toMajorUnits(decimalPlaces = 2): number {
    return this._amount / Math.pow(10, decimalPlaces);
  }

  /**
   * Create from major currency units (e.g., dollars to cents)
   */
  static fromMajorUnits(amount: number, currency: string, decimalPlaces = 2): Money {
    const minorUnits = Math.round(amount * Math.pow(10, decimalPlaces));
    return new Money(minorUnits, currency);
  }

  /**
   * String representation
   */
  toString(): string {
    return `${this._currency} ${this._amount}`;
  }

  /**
   * JSON representation
   */
  toJSON() {
    return {
      amount: this._amount,
      currency: this._currency,
    };
  }
}