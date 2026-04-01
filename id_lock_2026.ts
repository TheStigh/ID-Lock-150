import {Zcl} from "zigbee-herdsman";

import * as constants from "zigbee-herdsman-converters/lib/constants";
import * as exposes from "zigbee-herdsman-converters/lib/exposes";
import * as reporting from "zigbee-herdsman-converters/lib/reporting";
import {repInterval} from "zigbee-herdsman-converters/lib/constants";
import * as fz from "zigbee-herdsman-converters/converters/fromZigbee";
import * as tz from "zigbee-herdsman-converters/converters/toZigbee";
import type {DefinitionWithExtend, KeyValueAny, Tz} from "zigbee-herdsman-converters/lib/types";
import * as utils from "zigbee-herdsman-converters/lib/utils";

const e = exposes.presets;
const ea = exposes.access;

const pincodeLockPreserveLeadingZero: Tz.Converter = {
    key: ["pin_code"],
    convertSet: async (entity, key, value, meta) => {
        utils.assertObject(value, key);

        const user = value.user;
        const userType = value.user_type || "unrestricted";
        const userEnabled = value.user_enabled != null ? value.user_enabled : true;
        const pinCodeInput = value.pin_code;

        if (Number.isNaN(user)) throw new Error("user must be numbers");
        const pinCodeCount = utils.getMetaValue<number>(entity, meta.mapped, "pinCodeCount");
        if (!utils.isInRange(0, pinCodeCount - 1, user)) throw new Error("user must be in range for device");

        if (pinCodeInput == null) {
            await entity.command("closuresDoorLock", "clearPinCode", {userid: user}, utils.getOptions(meta.mapped, entity));
            return;
        }

        // Keep the PIN exactly as provided when it is a string (e.g. "0123").
        // Numeric input is rejected because leading zeros are already lost before conversion.
        if (!utils.isString(pinCodeInput)) {
            throw new Error('pin_code must be a string (e.g. "0123") to preserve leading zeros');
        }

        const typeLookup = {unrestricted: 0, year_day_schedule: 1, week_day_schedule: 2, master: 3, non_access: 4};
        const payload = {
            userid: user,
            userstatus: userEnabled ? 1 : 3,
            usertype: utils.getFromLookup(userType, typeLookup),
            pincodevalue: pinCodeInput,
        };

        await entity.command("closuresDoorLock", "setPinCode", payload, utils.getOptions(meta.mapped, entity));
    },
    convertGet: async (entity, key, meta) => {
        // @ts-expect-error read specific user from message payload when provided
        const user = meta?.message?.pin_code ? meta.message.pin_code.user : undefined;

        if (user === undefined) {
            const max = utils.getMetaValue<number>(entity, meta.mapped, "pinCodeCount");
            const options = utils.getOptions(meta.mapped, entity);
            for (let i = 0; i < max; i++) {
                await entity.command("closuresDoorLock", "getPinCode", {userid: i}, options);
            }
            return;
        }

        if (Number.isNaN(user)) {
            throw new Error("user must be numbers");
        }

        const pinCodeCount = utils.getMetaValue<number>(entity, meta.mapped, "pinCodeCount");
        if (!utils.isInRange(0, pinCodeCount - 1, user)) {
            throw new Error("user must be in range for device");
        }

        const payload: KeyValueAny = {userid: user};
        await entity.command("closuresDoorLock", "getPinCode", payload, utils.getOptions(meta.mapped, entity));
    },
};

const definition: DefinitionWithExtend = {
    zigbeeModel: ["ID Lock 150", "ID Lock 202"],
    model: "0402946",
    vendor: "Datek",
    description: "Zigbee module for ID lock",
    fromZigbee: [
        fz.lock,
        fz.battery,
        fz.lock_operation_event,
        fz.lock_programming_event,
        fz.idlock,
        fz.idlock_fw,
        fz.lock_pin_code_response,
        fz.lock_programming_event_read_pincode,
    ],
    toZigbee: [
        tz.lock,
        tz.lock_sound_volume,
        tz.idlock_master_pin_mode,
        tz.idlock_rfid_enable,
        tz.idlock_service_mode,
        tz.idlock_lock_mode,
        tz.idlock_relock_enabled,
        pincodeLockPreserveLeadingZero,
    ],
    meta: {pinCodeCount: 109},
    configure: async (device, coordinatorEndpoint) => {
        const endpoint = device.getEndpoint(1);
        const options = {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS};
        await reporting.bind(endpoint, coordinatorEndpoint, ["closuresDoorLock", "genPowerCfg"]);
        await reporting.lockState(endpoint);
        await reporting.batteryPercentageRemaining(endpoint);

        const payload = [
            {
                attribute: {ID: 0x4000, type: 0x10},
                minimumReportInterval: 0,
                maximumReportInterval: repInterval.HOUR,
                reportableChange: 1,
            },
            {
                attribute: {ID: 0x4001, type: 0x10},
                minimumReportInterval: 0,
                maximumReportInterval: repInterval.HOUR,
                reportableChange: 1,
            },
            {
                attribute: {ID: 0x4003, type: 0x20},
                minimumReportInterval: 0,
                maximumReportInterval: repInterval.HOUR,
                reportableChange: 1,
            },
            {
                attribute: {ID: 0x4004, type: 0x20},
                minimumReportInterval: 0,
                maximumReportInterval: repInterval.HOUR,
                reportableChange: 1,
            },
            {
                attribute: {ID: 0x4005, type: 0x10},
                minimumReportInterval: 0,
                maximumReportInterval: repInterval.HOUR,
                reportableChange: 1,
            },
        ];

        await endpoint.configureReporting("closuresDoorLock", payload, options);
        await endpoint.read("closuresDoorLock", ["lockState", "soundVolume", "doorState"]);
        await endpoint.read("closuresDoorLock", [0x4000, 0x4001, 0x4003, 0x4004, 0x4005], options);
        await endpoint.read("genBasic", [0x5000], options);
    },
    exposes: [
        e.lock(),
        e.battery(),
        e.pincode(),
        e.door_state(),
        e.lock_action(),
        e.lock_action_source_name(),
        e.lock_action_user(),
        e.enum("sound_volume", ea.ALL, constants.lockSoundVolume).withDescription("Sound volume of the lock"),
        e.binary("master_pin_mode", ea.ALL, true, false).withDescription("Allow Master PIN Unlock"),
        e.binary("rfid_enable", ea.ALL, true, false).withDescription("Allow RFID to Unlock"),
        e.binary("relock_enabled", ea.ALL, true, false).withDescription("Allow Auto Re-Lock"),
        e
            .enum("lock_mode", ea.ALL, ["auto_off_away_off", "auto_on_away_off", "auto_off_away_on", "auto_on_away_on"])
            .withDescription("Lock-Mode of the Lock"),
        e.enum("service_mode", ea.ALL, ["deactivated", "random_pin_1x_use", "random_pin_24_hours"]).withDescription("Service Mode of the Lock"),
    ],
};

export default definition;
