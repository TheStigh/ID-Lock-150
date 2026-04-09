import {Zcl} from "zigbee-herdsman";

import * as constants from "zigbee-herdsman-converters/lib/constants";
import * as exposes from "zigbee-herdsman-converters/lib/exposes";
import * as reporting from "zigbee-herdsman-converters/lib/reporting";
import {repInterval} from "zigbee-herdsman-converters/lib/constants";
import * as fz from "zigbee-herdsman-converters/converters/fromZigbee";
import * as utils from "zigbee-herdsman-converters/lib/utils";

const e = exposes.presets;
const ea = exposes.access;
const pinCodeExposeSimple = exposes
    .composite("pin_code", "pin_code", ea.ALL)
    .withFeature(exposes.numeric("user", ea.SET).withDescription("User ID to set or clear the pincode for"))
    .withFeature(exposes.text("pin_code", ea.SET).withLabel("PIN code").withDescription("Pincode to set as string, set pincode to null to clear"));
const pinCodeDeleteExpose = exposes
    .composite("pin_code_delete", "pin_code_delete", ea.SET)
    .withFeature(exposes.numeric("user", ea.SET).withDescription("User ID to clear pincode for"));

const lockLocal = {
    key: ["state"],
    convertSet: async (entity, key, value, meta) => {
        let state = utils.isString(value) ? value.toUpperCase() : null;
        let pincode = "";

        if (utils.isObject(value)) {
            if (value.code) {
                pincode = utils.isString(value.code) ? value.code : "";
            }
            if (value.state) {
                state = utils.isString(value.state) ? value.state.toUpperCase() : null;
            }
        }

        utils.validateValue(state, ["LOCK", "UNLOCK", "TOGGLE"]);
        await entity.command(
            "closuresDoorLock",
            `${state.toLowerCase()}Door`,
            {pincodevalue: Buffer.from(pincode, "ascii")},
            utils.getOptions(meta.mapped, entity),
        );
    },
    convertGet: async (entity) => {
        await entity.read("closuresDoorLock", ["lockState"]);
    },
};

const lockSoundVolumeLocal = {
    key: ["sound_volume"],
    convertSet: async (entity, key, value, meta) => {
        utils.assertString(value, key);
        utils.validateValue(value, constants.lockSoundVolume);
        await entity.write("closuresDoorLock", {soundVolume: constants.lockSoundVolume.indexOf(value)}, utils.getOptions(meta.mapped, entity));
        return {state: {sound_volume: value}};
    },
    convertGet: async (entity) => {
        await entity.read("closuresDoorLock", ["soundVolume"]);
    },
};

const idlockMasterPinModeLocal = {
    key: ["master_pin_mode"],
    convertSet: async (entity, key, value) => {
        await entity.write(
            "closuresDoorLock",
            {16384: {value: value === true ? 1 : 0, type: 0x10}},
            {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS},
        );
        return {state: {master_pin_mode: value}};
    },
    convertGet: async (entity) => {
        await entity.read("closuresDoorLock", [0x4000], {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS});
    },
};

const idlockRfidEnableLocal = {
    key: ["rfid_enable"],
    convertSet: async (entity, key, value) => {
        await entity.write(
            "closuresDoorLock",
            {16385: {value: value === true ? 1 : 0, type: 0x10}},
            {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS},
        );
        return {state: {rfid_enable: value}};
    },
    convertGet: async (entity) => {
        await entity.read("closuresDoorLock", [0x4001], {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS});
    },
};

const idlockServiceModeLocal = {
    key: ["service_mode"],
    convertSet: async (entity, key, value) => {
        const lookup = {deactivated: 0, random_pin_1x_use: 5, random_pin_24_hours: 6};
        await entity.write(
            "closuresDoorLock",
            {16387: {value: utils.getFromLookup(value, lookup), type: 0x20}},
            {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS},
        );
        return {state: {service_mode: value}};
    },
    convertGet: async (entity) => {
        await entity.read("closuresDoorLock", [0x4003], {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS});
    },
};

const idlockLockModeLocal = {
    key: ["lock_mode"],
    convertSet: async (entity, key, value) => {
        const lookup = {auto_off_away_off: 0, auto_on_away_off: 1, auto_off_away_on: 2, auto_on_away_on: 3};
        await entity.write(
            "closuresDoorLock",
            {16388: {value: utils.getFromLookup(value, lookup), type: 0x20}},
            {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS},
        );
        return {state: {lock_mode: value}};
    },
    convertGet: async (entity) => {
        await entity.read("closuresDoorLock", [0x4004], {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS});
    },
};

const idlockRelockEnabledLocal = {
    key: ["relock_enabled"],
    convertSet: async (entity, key, value) => {
        await entity.write(
            "closuresDoorLock",
            {16389: {value: value === true ? 1 : 0, type: 0x10}},
            {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS},
        );
        return {state: {relock_enabled: value}};
    },
    convertGet: async (entity) => {
        await entity.read("closuresDoorLock", [0x4005], {manufacturerCode: Zcl.ManufacturerCode.DATEK_WIRELESS_AS});
    },
};

const pincodeLockPreserveLeadingZero = {
    key: ["pin_code"],
    convertSet: async (entity, key, value, meta) => {
        utils.assertObject(value, key);

        const user = value.user;
        const pinCodeInput = value.pin_code;

        if (Number.isNaN(user)) throw new Error("user must be numbers");
        const pinCodeCount = utils.getMetaValue(entity, meta.mapped, "pinCodeCount");
        if (!utils.isInRange(0, pinCodeCount - 1, user)) throw new Error("user must be in range for device");

        if (pinCodeInput == null) {
            await entity.command("closuresDoorLock", "clearPinCode", {userid: user}, utils.getOptions(meta.mapped, entity));
            return;
        }

        if (!utils.isString(pinCodeInput)) {
            throw new Error('pin_code must be a string (e.g. "011223") to preserve leading zeros');
        }
        const pinCodeValue = pinCodeInput;
        const payload = {
            userid: user,
            userstatus: 1,
            usertype: 0,
            pincodevalue: pinCodeValue,
        };

        await entity.command("closuresDoorLock", "setPinCode", payload, utils.getOptions(meta.mapped, entity));
    },
    convertGet: async (entity, key, meta) => {
        const user = meta?.message?.pin_code ? meta.message.pin_code.user : undefined;

        if (user === undefined) {
            const max = utils.getMetaValue(entity, meta.mapped, "pinCodeCount");
            const options = utils.getOptions(meta.mapped, entity);
            for (let i = 0; i < max; i++) {
                await entity.command("closuresDoorLock", "getPinCode", {userid: i}, options);
            }
            return;
        }

        if (Number.isNaN(user)) {
            throw new Error("user must be numbers");
        }

        const pinCodeCount = utils.getMetaValue(entity, meta.mapped, "pinCodeCount");
        if (!utils.isInRange(0, pinCodeCount - 1, user)) {
            throw new Error("user must be in range for device");
        }

        await entity.command("closuresDoorLock", "getPinCode", {userid: user}, utils.getOptions(meta.mapped, entity));
    },
};

const pincodeLockDelete = {
    key: ["pin_code_delete"],
    convertSet: async (entity, key, value, meta) => {
        utils.assertObject(value, key);
        const user = value.user;
        if (Number.isNaN(user)) throw new Error("user must be numbers");

        const pinCodeCount = utils.getMetaValue(entity, meta.mapped, "pinCodeCount");
        if (!utils.isInRange(0, pinCodeCount - 1, user)) throw new Error("user must be in range for device");

        await entity.command("closuresDoorLock", "clearPinCode", {userid: user}, utils.getOptions(meta.mapped, entity));
    },
};

const definition = {
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
        lockLocal,
        lockSoundVolumeLocal,
        idlockMasterPinModeLocal,
        idlockRfidEnableLocal,
        idlockServiceModeLocal,
        idlockLockModeLocal,
        idlockRelockEnabledLocal,
        pincodeLockPreserveLeadingZero,
        pincodeLockDelete,
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
        pinCodeExposeSimple,
        pinCodeDeleteExpose,
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
