import { describe, expect, it } from 'vitest';

import {
  XrplAccountInfoResponseSchema,
  XrplAccountTxResponseSchema,
  XrplAccountLinesResponseSchema,
} from '../xrpl-rpc.schemas.js';

describe('XRPL RPC Schemas', () => {
  describe('XrplAccountInfoResponseSchema', () => {
    it('should validate real account_info response', () => {
      const response = {
        result: {
          account_data: {
            Account: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
            Balance: '10618854104',
            Flags: 131072,
            LedgerEntryType: 'AccountRoot',
            OwnerCount: 0,
            PreviousTxnID: '4FB0B64A0900F114CEEC9FB2FE0BA0E1ACA762F93438650AACEAAA52666D8631',
            PreviousTxnLgrSeq: 101700817,
            Sequence: 568548,
            index: 'E50C9EE857E177CE38071B8930F66053C9C86DF9B8ADEDA632CB9DFF50EC0033',
          },
          ledger_hash: 'AAE7400BBC9A5228F24DD9C14C0FB37EE5671D03028B2B41411B28733EBB1DE6',
          ledger_index: 101700828,
          validated: true,
          account_flags: {
            requireDestinationTag: true,
            defaultRipple: false,
            depositAuth: false,
          },
          status: 'success' as const,
        },
        warnings: [
          {
            id: 2001,
            message: 'This is a clio server',
          },
        ],
      };

      const result = XrplAccountInfoResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.result.account_data.Balance).toBe('10618854104');
        expect(result.data.result.account_data.Account).toBe('rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh');
      }
    });
  });

  describe('XrplAccountTxResponseSchema', () => {
    it('should validate real account_tx response', () => {
      const response = {
        result: {
          account: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
          ledger_index_min: 32570,
          ledger_index_max: 101700828,
          transactions: [
            {
              meta: {
                AffectedNodes: [
                  {
                    ModifiedNode: {
                      FinalFields: {
                        Account: 'r9g7rqJGKLvDPy3vpT98KUcjc6gtBamNsq',
                        Balance: '452602411008',
                        Flags: 0,
                        OwnerCount: 0,
                        Sequence: 100514633,
                      },
                      LedgerEntryType: 'AccountRoot',
                      LedgerIndex: 'D26E3BD1CFA930FC996BA5458AD853902F59DBB13876B84C852CFED2F6B743C9',
                      PreviousFields: {
                        Balance: '452719345796',
                        Sequence: 100514632,
                      },
                      PreviousTxnID: '555C135E45D952FF2C97229B26E465A24C68803F8A09A1BC12CE37F836BFECB6',
                      PreviousTxnLgrSeq: 101700762,
                    },
                  },
                ],
                TransactionIndex: 34,
                TransactionResult: 'tesSUCCESS',
                delivered_amount: '116924788',
              },
              tx: {
                Account: 'r9g7rqJGKLvDPy3vpT98KUcjc6gtBamNsq',
                Amount: '116924788',
                Destination: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
                DestinationTag: 101892191,
                Fee: '10000',
                Flags: 2147483648,
                Sequence: 100514632,
                SigningPubKey: '03CF2ACDD027EFD4B031B4D66BF0CFCDA6C69168E63DF233F27911B4B68432F58E',
                TransactionType: 'Payment',
                TxnSignature:
                  '3045022100C5CF6374F26AE7E278C7F2CE5F80F860796094A1E9EAB15D7206C6561AA6B12B02202C55F478535C9FB1E482E49EF69446287E7AEB865C8E86EAA9D64E1C5A99006B',
                hash: '4FB0B64A0900F114CEEC9FB2FE0BA0E1ACA762F93438650AACEAAA52666D8631',
                DeliverMax: '116924788',
                ctid: 'C60FD4D100220000',
                date: 822274421,
                ledger_index: 101700817,
                inLedger: 101700817,
              },
              validated: true,
            },
          ],
          validated: true,
          marker: {
            ledger: 101700176,
            seq: 70,
          },
          limit: 3,
          status: 'success' as const,
        },
      };

      const result = XrplAccountTxResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.result.transactions).toHaveLength(1);
        expect(result.data.result.transactions[0]!.tx.TransactionType).toBe('Payment');
        expect(result.data.result.marker).toEqual({ ledger: 101700176, seq: 70 });
      }
    });
  });

  describe('XrplAccountLinesResponseSchema', () => {
    it('should validate real account_lines response', () => {
      const response = {
        result: {
          account: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
          ledger_hash: 'FDA9D8B8F293A58276AEAA6C9AF944879236C8B9FDFCD4A44DB5F70FF3BB6985',
          ledger_index: 101700832,
          validated: true,
          limit: 10,
          lines: [
            {
              account: 'r31AoW8ZUUuMRG74rkdCS9sefCFh5UKkYY',
              balance: '0',
              currency: 'NZD',
              limit: '0',
              limit_peer: '1000000000',
              quality_in: 0,
              quality_out: 0,
              no_ripple: true,
              no_ripple_peer: true,
            },
          ],
          marker: '4497D8A47F992B19E8D516BA01BD19E07EB3BA774276A4A88F2C78E93889205F,0',
          status: 'success' as const,
        },
      };

      const result = XrplAccountLinesResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.result.lines).toHaveLength(1);
        expect(result.data.result.lines[0]!.currency).toBe('NZD');
      }
    });
  });
});
