import { Model, Table, Column, PrimaryKey, DataType } from 'sequelize-typescript';
import { FundingSettings } from '@/common/model/funding-plan';
import db from '@/server/common/entity/db';

@Table({ tableName: 'funding_settings' })
class FundingSettingsEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  declare enabled: boolean;

  @Column({ type: DataType.INTEGER })
  declare monthly_price: number; // in millicents

  @Column({ type: DataType.INTEGER })
  declare yearly_price: number; // in millicents

  @Column({ type: DataType.STRING(3), defaultValue: 'USD' })
  declare currency: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  declare pay_what_you_can: boolean;

  @Column({ type: DataType.INTEGER, defaultValue: 7 })
  declare grace_period_days: number;

  /**
   * Convert entity to domain model
   */
  toModel(): FundingSettings {
    const settings = new FundingSettings(this.id);
    settings.enabled = this.enabled;
    settings.monthlyPrice = this.monthly_price;
    settings.yearlyPrice = this.yearly_price;
    settings.currency = this.currency;
    settings.payWhatYouCan = this.pay_what_you_can;
    settings.gracePeriodDays = this.grace_period_days;
    return settings;
  }

  /**
   * Convert domain model to entity
   */
  static fromModel(settings: FundingSettings): FundingSettingsEntity {
    return FundingSettingsEntity.build({
      id: settings.id,
      enabled: settings.enabled,
      monthly_price: settings.monthlyPrice,
      yearly_price: settings.yearlyPrice,
      currency: settings.currency,
      pay_what_you_can: settings.payWhatYouCan,
      grace_period_days: settings.gracePeriodDays,
    });
  }
}

db.addModels([FundingSettingsEntity]);

export { FundingSettingsEntity };
